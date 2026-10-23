  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Choices people make on the page. They're kept in this browser and, for someone signed in, in their account
  // too (data/users/<id>/prefs, see syncPrefs), so they come along to other devices.
  const PREF_KEYS = ["selected", "bookShow", "pickChs", "tShow", "tChs", "groupBy", "pickTags", "dir", "mode", "uptoPick", "loveWin", "palette", "theme", "resume", "share", "practices"];
  let prefsChanged = () => {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem("jpq:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {
      if (PREF_KEYS.includes(k)) prefsChanged();
      try { localStorage.setItem("jpq:" + k, JSON.stringify(v)); return true; } catch { return false; }
    },
  };
  // Before tags, the Show row switched kinds of sets off; the kinds left on carry over as picked tags.
  function oldKindPicks() {
    const k = store.get("pickKinds", null);
    if (!Array.isArray(k) || !k.length || k.length >= 3) return [];
    return k.map((x) => ({ main: "main sets", extras: "extras", supp: "supp." })[x]).filter(Boolean);
  }
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rid = () => Math.random().toString(36).slice(2, 9);

  let db = null, user = null, sample = null, uid = null, canWrite = false, owner = false;
  // Export / import works from the documents exactly as stored, not the tidied copies the page renders from.
  let downloads = null, importPlan = null, importing = false;
  const raw = { sets: [], kanji: [], books: null, courses: null };
  const S = {
    sets: [], loaded: false,
    selected: new Set(store.get("selected", [])),
    // Units shown on the practice page (pick) and in the vocab table (tpick), see makePicker. pick.show null = a page before v42,
    // where an empty pickChs meant everything; tpick.show null = a page before v45, which showed one book and chapter (tableBook, tableCh).
    // (Older pages also stored the books shown, in pickBooks or pickBook, and bare chapter numbers, read as chapters of the first book.)
    pick: { show: store.get("bookShow", null), picks: new Set(store.get("pickChs", null) ?? [store.get("pickCh", "all")].filter((c) => c !== "all")) },
    tpick: { show: store.get("tShow", null), picks: new Set(store.get("tChs", [])) },
    groupBy: store.get("groupBy", "book"), // unit rows by collection ("book") or "course"
    courses: [],                           // meta/courses: [{name, parts: [{collection, from, to}]}], in course order; a line break in a name breaks its label
    oldBooks: store.get("pickBooks", null) ?? (store.get("pickBook", null) != null ? [store.get("pickBook", null)] : null),
    tableBook: store.get("tableBook", null), // book shown in the vocab table
    pickTags: new Set(store.get("pickTags", null) ?? oldKindPicks()), // tags picked in the Filter row (lowercase); none = every set
    dir: store.get("dir", "ej"),
    mode: store.get("mode", "default"),
    kanjiLists: [],      // [{id, collection, unit, kanji}]
    upto: store.get("uptoPick", "auto"), // "auto" follows the highest picked unit; older manual picks lived under "upto"
    kdrafts: new Map(),  // listId -> edited kanji string
    kConfirmDel: null,
    drafts: new Map(),   // setId -> words[] being edited
    confirmDel: null,
    tableCh: store.get("tableCh", null), // chapter shown in the vocab table
    tq: "",              // vocab table search text
    openSets: new Set(), // expanded sets in the vocab table
    touched: new Set(),  // word ids edited during the current search, kept visible
    kAll: false,         // kanji panel: every unit instead of the vocab table's units
    tAll: false,         // search: draw every match instead of the first TLIMIT
    editSet: null, editVals: null, // set whose collection/unit/name is being edited
    kEdit: null, kEditUnit: "", kEditCol: "",  // kanji list whose collection and unit are being edited
    formCol: null,                 // collection last filled into the new set / new kanji forms
    colOrder: [],                  // saved book order (meta/books); books not in it come after, by name
    orderEdit: null,               // the collection order being edited in the vocab table, or null
  };

  // ---------- views ----------
  const views = ["setup", "quiz", "results", "table", "history"];
  // Colour palette: per viewer, remembered in this browser.
  function setPalette(name) {
    name = name === "claude" ? "claude" : "indigo";
    if (name === "claude") document.documentElement.dataset.palette = "claude"; else delete document.documentElement.dataset.palette;
    document.querySelectorAll("#palPick [data-pal]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.pal === name));
    store.set("palette", name);
    pads.forEach((p) => p.draw());
  }
  document.querySelectorAll("#palPick [data-pal]").forEach((b) => (b.onclick = () => setPalette(b.dataset.pal)));
  // Settings pop-up (the gear in the header): colours, the vocab counts, export / import, and on the public site light or dark,
  // the account and deleting.
  function openSettings() { renderSettings(); $("#settings").showModal(); }
  $("#settingsBtn").onclick = openSettings;
  $("#settingsClose").onclick = () => $("#settings").close();
  $("#settings").addEventListener("click", (e) => { if (e.target === $("#settings")) $("#settings").close(); });
  function renderSettings() {
    const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`, words = S.sets.reduce((a, s) => a + readyCount(s.words || []), 0);
    $("#setStats").textContent = [n(S.sets.length, "set"), n(words, "word"), n(S.kanjiLists.length, "kanji list"), ...(S.history?.length ? [n(S.history.length, "practice session") + " saved"] : [])].join(" · ");
    renderPort();
    //#if public
    renderAccount(); renderShare();
    //#endif
  }
  function setTheme(t) {
    t = t === "light" || t === "dark" ? t : "";
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    document.querySelectorAll("#themePick [data-theme-pick]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themePick === t));
    store.set("theme", t);
  }
  document.querySelectorAll("#themePick [data-theme-pick]").forEach((b) => (b.onclick = () => setTheme(b.dataset.themePick)));
  setTheme(store.get("theme", ""));
  function show(v) { views.forEach((x) => ($("#" + x).hidden = x !== v)); document.body.classList.toggle("writing", v === "quiz"); window.scrollTo(0, 0); if (v === "quiz") pads.forEach((p) => p.resize()); }
  function banner(msg) { const b = $("#banner"); b.hidden = !msg; b.textContent = msg || ""; }

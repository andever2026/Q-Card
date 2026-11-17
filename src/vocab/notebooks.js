  // ---------- notebooks: the one that's open, and the menu at the top of the sidebar ----------
  // What a notebook is and where its documents are: vocab/docs.js. The page shows one at a time (nb, page/core.js):
  // Practice, Vocabulary, Export and Import are all that notebook's. Progress and Settings are the whole account's.
  // The menu lists them and opens one; whoever can change the vocab can also add, rename and delete.
  const nbList = () => S.notebooks || [{ id: MAIN_NB, name: NB_NAME }];
  // Notebooks that aren't the account's own (a group's, on the public site: groups/groups.js) are in nbOthers(), as
  // { id, name, group, edit (false: read only), rename(name)?, drop()? (when this account may) }; nbPending(id) says one
  // of those may still be loading, so it isn't given up on yet; nbAt(id) is the store as that notebook sees it.
  let nbOthers = () => [], nbPending = () => false, nbAt = (id) => inNotebook(db, id);
  const allNbs = () => [...nbList(), ...nbOthers()];
  const nbName = (id = nb) => allNbs().find((n) => n.id === id)?.name ?? NB_NAME;
  const nbRef = () => db.doc("meta/notebooks");
  const nbNow = () => allNbs().find((n) => n.id === nb);
  // Whether the open notebook's vocab can be changed here: canWrite (page/core.js) is the account's, and some notebooks are read only.
  const canEdit = () => canWrite && nbNow()?.edit !== false;
  // Whether the open notebook could be changed when it was drawn: it's drawn again when that changes (a role in a group).
  let drawnEdit = null;
  function followEdit() { if (drawnEdit !== canEdit()) { drawnEdit = canEdit(); renderSetup(); renderTable(); } }
  // What other parts of the page add to notebooks (shared notebooks, on the public site): vocabHooks run after the open
  // notebook's vocab or the list of notebooks changes, nbGone before a notebook's documents are deleted (with its id),
  // and nbMore are further lines of the menu: { key, label(), icon (an svg path), run, when() }.
  // nbSections are further parts of the list, each a function of nbButton giving its HTML, and nbActs what their buttons
  // run (data-nb-do, with data-arg).
  const vocabHooks = [], nbGone = [], nbMore = [], nbSections = [], nbActs = {};
  const vocabChanged = () => vocabHooks.forEach((f) => f());
  // In a notebook added from a shared one (its line in the list has from), each set keeps the words as they came from
  // its owner in base: a word that isn't there, or reads differently, is one this person added or changed.
  const wordKey = (w) => [w.en, w.kana, w.kanji].map((x) => (x || "").trim()).join("\u0001");
  let came = { of: null, words: null };
  function ownWord(s, w) {
    if (came.of !== raw.sets) came = { of: raw.sets, words: nbNow()?.from ? new Map(raw.sets.map((d) => [d.id, new Map((d.base?.words || []).map((x) => [x.id, wordKey(x)]))])) : null };
    return !!came.words && came.words.get(s.id)?.get(w.id) !== wordKey(w);
  }
  // A name no other notebook has: the one asked for, or that with a number (was: the name it has now, which it may keep).
  // (Among list: a group's notebooks are named apart from the account's own.)
  const nbFree = (want, was = "", list = nbList()) => freeName(want, list.map((n) => n.name).filter((t) => !sameName(t, was)));
  // Whether the list has loaded, for what mustn't write into a notebook this account may not have (the sample sets).
  let nbLoaded = () => {};
  const nbReady = new Promise((ok) => (nbLoaded = ok));
  function watchNotebooks() {
    nbRef().onSnapshot((snap) => {
      S.notebooks = cleanNotebooks(dataOrNull(snap));
      // The open one may be gone (deleted on another device, or remembered by this browser from another account): the first opens.
      if (!openNotebook(nb)) renderNotebooks();
      nbLoaded(); vocabChanged();
    }, () => nbLoaded());
  }
  // Opens a notebook: its vocab and its own choices replace what the page holds. false when that one is open already.
  function openNotebook(id) {
    if (S.notebooks && !allNbs().some((n) => n.id === id) && !nbPending(id)) id = S.notebooks[0].id;
    if (id === nb) return false;
    nb = id; kept.set("notebook", id);
    Object.assign(S, { sets: [], loaded: false, kanjiLists: [], kLoaded: false, colOrder: [], courses: [], viewDoc: null, colEdit: null, editNew: null,
      confirmDel: null, kConfirmDel: null, leaveAsk: false, formCol: null, oldBooks: null, tableBook: null, tableCh: null, tq: "", kAll: false, tAll: false });
    Object.assign(raw, { sets: [], kanji: [], books: null, courses: null, views: null });
    for (const k of ["drafts", "kdrafts", "openSets", "touched"]) S[k].clear();
    $("#tSearch").value = "";
    readPicks();
    if (db) watchVocab();
    renderNotebooks();
    // Results are of a practice from the notebook before: back to Practice. Any other part shows the new notebook.
    if (!$("#results").hidden) show("setup");
    drawnEdit = canEdit(); renderSetup(); renderTable();
    if (!$("#history").hidden) renderHistory();
    if (!$("#settings").hidden) renderSettings();
    return true;
  }
  // Saves the list (shown at once; the saved copy comes back through watchNotebooks). false if it couldn't be saved.
  async function saveNotebooks(list) {
    const was = S.notebooks;
    S.notebooks = list; renderNotebooks();
    try { await nbRef().set({ list, updatedAt: new Date().toISOString() }); return true; }
    catch { S.notebooks = was; renderNotebooks(); banner("Couldn't save that. Try again."); return false; }
  }
  // One notebook's line in the list, replaced.
  // (A group's notebook saves its own line: n.save, groups/groups.js.)
  const saveNb = (n) => (n.save ? n.save(n) : saveNotebooks(nbList().map((x) => (x.id === n.id ? n : x))));
  // Every vocab document in one place (a notebook, or a notebook's shared copy), deleted.
  async function emptyVocab(at) {
    for (const c of ["sets", "kanji"]) for (const d of (await at.collection(c).get()).docs) await at.doc(`${c}/${d.id}`).delete();
    for (const p of ["meta/books", "meta/courses", "meta/views", "meta/link"]) await at.doc(p).delete();
  }
  // Every document of one notebook, deleted (its line in the list is the caller's). Deleting an account uses it too.
  async function emptyNotebook(id) {
    for (const f of nbGone) await f(id);
    await emptyVocab(nbAt(id));
  }
  // A notebook's own choices (see store, page/core.js), to move them to another id or (null) let them go with it.
  const picksOf = (id) => (id === MAIN_NB ? Object.fromEntries(NB_KEYS.map((k) => [k, kept.get(k, null)])) : kept.get("nbPicks", null)?.[id] || {});
  function setPicks(id, v) {
    if (id === MAIN_NB) return NB_KEYS.forEach((k) => kept.set(k, v?.[k] ?? null));
    const all = { ...kept.get("nbPicks", null) };
    if (v) all[id] = v; else delete all[id];
    kept.set("nbPicks", all);
  }
  // A name typed into the page's pop-up: "" when it's cancelled or left empty. A name another one in list has gets a number.
  // (n: how long it may be, leaving room for the number; a role's name is shorter.)
  async function askNbName(title, yes, was = "", list = nbList(), what = "Notebook name", eg = "Japanese 2", n = 56) {
    const answer = ask(title, `<input class="tsearch" id="nbNameIn" maxlength="${n + 4}" aria-label="${what}" placeholder="${eg}" value="${esc(was)}">`, yes);
    const inp = $("#nbNameIn");
    inp.focus(); inp.select();
    enterYes(inp);
    return nbFree((await answer) ? tidy(inp.value, n) : "", was, list);
  }
  async function addNotebook() {
    const name = await askNbName("New notebook", "Create");
    if (!name) return;
    const id = "n" + rid();
    if (await saveNotebooks([...nbList(), { id, name }])) openNotebook(id);
  }
  // A group's notebook is renamed or deleted in the group (its rename and drop), any other in the account's list.
  async function renameNotebook() {
    const n = nbNow(), name = await askNbName("Rename this notebook", "Rename", n.name, n.rename ? nbOthers().filter((x) => x.group === n.group) : nbList());
    if (name && name !== n.name) await (n.rename ? n.rename(name) : saveNb({ ...n, name }));
  }
  async function deleteNotebook() {
    const id = nb, n = nbNow(), rest = nbList().filter((x) => x.id !== id);
    if (!n.drop && !rest.length) return;
    const holds = [S.sets.length && plural(S.sets.length, "set"), S.kanjiLists.length && plural(S.kanjiLists.length, "kanji list")].filter(Boolean).join(" and ");
    if (!(await ask(`Delete “${nbName()}”?`, `<p>${holds ? `This notebook and its ${holds} are deleted for good. Export it first if you want a copy.` : "This notebook is empty."}</p>`, "Delete notebook", true))) return;
    try { await emptyNotebook(id); } catch { return banner("Couldn't delete all of that notebook. Try again."); }
    if (!(await (n.drop ? n.drop() : saveNotebooks(rest)))) return;
    setPicks(id, null); // its own choices go with it
    openNotebook(nbList()[0].id);
  }
  // Opening another one from the vocab table asks about unsaved changes first, as leaving the table any other way does.
  function pickNotebook(id) {
    if (id === nb) return;
    if (!$("#table").hidden) leaveTable(() => { openNotebook(id); show("table"); }); else openNotebook(id);
  }
  const nbMenu = makeMenu($("#nbPick"), $("#nbBtn"), $("#nbList")); // page/menu.js
  const nbIcon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  let nbDrawn = "";
  const nbButton = (n) => `<button type="button" role="menuitemradio" aria-checked="${n.id === nb}" data-nb="${esc(n.id)}">${nbIcon(n.id === nb ? "M5 12.5 L10 17.5 L19 7" : "")}${esc(n.name)}</button>`;
  function renderNotebooks() {
    const list = nbList(), now = nbNow(), icon = nbIcon;
    $("#nbName").textContent = nbName();
    // Headings over what is the open notebook's alone (its hard words in Progress, its counts and Export / Import in Settings) name it once there's more than one.
    document.querySelectorAll(".nbin").forEach((e) => (e.textContent = allNbs().length < 2 ? "" : ` in ${nbName()}`));
    $("#nbBtn").setAttribute("aria-label", `Notebook: ${nbName()}`);
    if ($("#nbBtn").title) $("#nbBtn").title = nbName(); // shown only while the sidebar is shrunk to its icons (page/nav.js)
    // Rename and Delete are the open notebook's: one of the account's own, or a group's for whoever may (its rename and drop).
    const own = !now?.group;
    const html = `<p class="small muted">Notebooks</p>
      ${list.map(nbButton).join("")}
      ${nbSections.map((f) => f(nbButton)).join("")}
      ${canWrite && db ? `<hr><button type="button" role="menuitem" data-nb-do="add">${icon("M12 5 V19 M5 12 H19")}New notebook</button>
      ${own || now?.rename ? `<button type="button" role="menuitem" data-nb-do="rename">${icon("M4.5 19.5 L5.3 15.7 L15.4 5.6 a2 2 0 0 1 2.8 0 l.2 .2 a2 2 0 0 1 0 2.8 L8.3 18.7Z")}Rename this notebook</button>` : ""}
      ${nbMore.filter((m) => m.when()).map((m) => `<button type="button" role="menuitem" data-nb-do="${m.key}">${icon(m.icon)}${m.label()}</button>`).join("")}
      ${(own && list.length > 1) || now?.drop ? `<button type="button" role="menuitem" class="danger" data-nb-do="delete">${icon("M4 7 H20 M9.5 7 V4.5 H14.5 V7 M6.5 7 L7.3 19.5 H16.7 L17.5 7")}Delete this notebook</button>` : ""}` : ""}`;
    // Drawn again only when it changed (groups change often), keeping the focus where it was if the menu is open.
    const box = $("#nbList"), had = box.contains(document.activeElement) && document.activeElement, at = had && ["nb", "nbDo", "arg"].filter((k) => had.dataset[k] != null).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(had.dataset[k])}"]`).join("");
    if (nbDrawn === html) return;
    box.innerHTML = nbDrawn = html;
    if (had) (box.querySelector(at || "button") || box.querySelector("button")).focus();
    const act = { add: addNotebook, rename: renameNotebook, delete: deleteNotebook, ...Object.fromEntries(nbMore.map((m) => [m.key, m.run])), ...nbActs };
    box.querySelectorAll("button").forEach((b) => (b.onclick = () => { nbMenu(false); menu(false); if (b.dataset.nb) pickNotebook(b.dataset.nb); else act[b.dataset.nbDo](b.dataset.arg); }));
  }
  renderNotebooks();

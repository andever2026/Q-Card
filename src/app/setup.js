  // What each kanji rule does depends on the direction: it shapes what you write, what the question shows, or both.
  const MODE_TEXT = {
    ej: {
      default: "Kanji optional. If you add furigana, it gets checked too.",
      kanji: "Kanji you’ve learned must be written as kanji.",
      kana: "Only the reading counts, kanji mistakes are ignored.",
      kata: "Narrows the picked set(s) to the words that include katakana.",
      verb: "Narrows the picked set(s) to verbs only, and goes through their five forms.",
    },
    je: {
      default: "Words show as written in the set, with the reading underneath.",
      kanji: "Words show only the kanji you’ve learned, with no reading.",
      kana: "Words show in kana only.",
      kata: "Narrows the picked set(s) to the words that include katakana.",
      verb: "Only for English → 日本語.",
    },
    both: {
      default: "Kanji optional when you write. Japanese questions show the word as written, with the reading.",
      kanji: "Kanji you’ve learned must be written as kanji, and Japanese questions show only those kanji, with no reading.",
      kana: "Only the reading counts when you write, and Japanese questions show kana only.",
      kata: "Narrows the picked set(s) to the words that include katakana.",
      verb: "Only for English → 日本語.",
    },
  };
  // Sets are filtered by unit and by tag (the Filter row); picks in hidden sets stay picked.
  const setKind = (s) => (/^supp/i.test(s.name) ? "supp" : /^extra/i.test(s.name) ? "extras" : "main");
  // A set's tags are its own (sets/<id>.tags, from its details) plus its kind from the start of its name, when the table has
  // more than one kind. Tags match without case; a comma (or 、) separates them when typed.
  const KIND_TAGS = { main: "Main sets", extras: "Extras", supp: "Supp." };
  const tagKey = (t) => t.toLowerCase();
  function cleanTags(v) {
    const out = [], seen = new Set();
    for (const t of Array.isArray(v) ? v : String(v ?? "").split(/[,、，]/)) {
      const x = String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
      if (x && !seen.has(tagKey(x)) && out.length < 12) { seen.add(tagKey(x)); out.push(x); }
    }
    return out;
  }
  const setTags = (s, kinds) => cleanTags([...(kinds ? [KIND_TAGS[setKind(s)]] : []), ...(Array.isArray(s.tags) ? s.tags : [])]);
  // Every tag in use: [{key, name, n}], n = sets with it. The Filter row puts the ones that hide the most sets first.
  function tagCounts() {
    const kinds = new Set(S.sets.map(setKind)).size > 1, m = new Map();
    for (const s of S.sets) for (const t of setTags(s, kinds)) { const k = tagKey(t); if (!m.has(k)) m.set(k, { key: k, name: t, n: 0 }); m.get(k).n++; }
    return { kinds, list: [...m.values()].sort((a, b) => a.n - b.n || a.name.localeCompare(b.name)) };
  }
  const setCols = () => cols().filter((b) => S.sets.some((s) => colOf(s) === b));
  const unitsOf = (col) => [...new Set(S.sets.filter((s) => colOf(s) === col).map((s) => s.unit))];
  const colKeys = (col) => unitsOf(col).map((c) => `${col}\u0001${c}`);
  const courseMode = () => S.groupBy === "course" && S.courses.length > 0;
  // A unit picker: one row of chips per collection, or per course with any units no course covers under "Other".
  // Each collection shows all, none or some of its units: st.show maps collection -> "all" | "none" | "some" (missing = "all"),
  // and st.picks holds the unitKey()s shown for "some". o: { st, showKey, chsKey, cols(), keys(col), bar, rows, dot(key), onChange() }.
  function makePicker(o) {
    const st = o.st;
    const picksOf = (b) => [...st.picks].filter((k) => k.startsWith(b + "\u0001"));
    const save = () => { store.set(o.showKey, st.show); store.set(o.chsKey, [...st.picks]); };
    const p = {
      picksOf,
      // "some" with no units left counts as "none".
      state(b) { const m = st.show?.[b] ?? "all"; return m === "some" && !picksOf(b).length ? "none" : m; },
      has(k) { const b = k.split("\u0001")[0], m = p.state(b); return m === "all" || (m === "some" && st.picks.has(k)); },
      shownKeys: () => o.cols().flatMap(o.keys).filter(p.has),
      // Shows exactly the unit keys given.
      set(keys) {
        const show = { ...st.show };
        for (const b of o.cols()) {
          const ks = o.keys(b), on = ks.filter((k) => keys.has(k));
          show[b] = on.length === ks.length ? "all" : on.length ? "some" : "none";
          picksOf(b).forEach((k) => st.picks.delete(k));
          if (show[b] === "some") on.forEach((k) => st.picks.add(k));
        }
        st.show = show; save();
      },
      // Makes sure one unit shows, even one that is only about to be added.
      add(k) {
        const b = k.split("\u0001")[0], m = p.state(b);
        if (m === "all") return;
        if (m === "none") picksOf(b).forEach((x) => st.picks.delete(x));
        st.picks.add(k); st.show = { ...st.show, [b]: "some" }; save();
      },
      replace(show, picks) { st.show = show; st.picks = picks; save(); },
      groups() {
        const bs = o.cols();
        if (!courseMode()) return bs.map((b) => ({ name: colLabel(b), keys: o.keys(b) }));
        const all = bs.flatMap(o.keys), used = new Set();
        const inPart = (k, pt) => { const [b, u] = k.split("\u0001"); return b === pt.collection && byUnit(u, pt.from) >= 0 && byUnit(u, pt.to) <= 0; };
        const gs = S.courses.map((c) => {
          const keys = all.filter((k) => !used.has(k) && c.parts.some((pt) => inPart(k, pt)));
          keys.forEach((k) => used.add(k));
          return { name: c.name, keys };
        }).filter((g) => g.keys.length);
        const rest = all.filter((k) => !used.has(k));
        return rest.length ? [...gs, { name: "Other", keys: rest }] : gs;
      },
      render() {
        const groups = p.groups(), labeled = groups.length > 1 || courseMode();
        const stateOf = (g) => { const on = g.keys.filter(p.has).length; return on === g.keys.length ? "all" : on ? "some" : "none"; };
        // Each row is led by its name when there's more than one row (or rows are courses).
        o.bar.classList.toggle("labeled", labeled);
        o.rows.innerHTML = groups.map((g, gi) => {
          const sg = stateOf(g);
          const chips = g.keys.map((k, i) => `<button class="chip" type="button" data-k="${i}" aria-pressed="${sg === "some" && p.has(k)}">${esc(keyUnit(k))}${o.dot(k)}</button>`).join("");
          return `<div class="pchrow" data-g="${gi}">${labeled ? `<span class="chbook muted small${g.name.includes("\n") ? " two" : ""}">${esc(g.name)}</span>` : ""}<div class="chips"><button class="chip" type="button" data-k="all" aria-pressed="${sg === "all"}">All</button>${chips}</div></div>`;
        }).join("");
        // The label column is as wide as the widest name in either view (collections or courses), so switching views doesn't shift the chips.
        const lab = o.rows.querySelector(".chbook");
        if (lab) {
          const ctx = (makePicker.cv ||= document.createElement("canvas")).getContext("2d");
          ctx.font = getComputedStyle(lab).font;
          const names = [...o.cols().map(colLabel), ...S.courses.map((c) => c.name), "Other"];
          const w = Math.max(...names.flatMap((n) => n.split("\n")).map((t) => ctx.measureText(t).width));
          o.bar.style.setProperty("--labw", Math.ceil(w) + 1 + "px");
        }
        // All turns a whole row on or off. A unit tapped while its row is all on or all off shows just that unit
        // of the row; after that, units toggle on their own, and picking every unit of a row is the same as its All.
        o.rows.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
          const g = groups[+b.closest("[data-g]").dataset.g], sg = stateOf(g), k = b.dataset.k === "all" ? null : g.keys[+b.dataset.k];
          const keys = new Set(p.shownKeys());
          if (!k) g.keys.forEach((x) => (sg === "all" ? keys.delete(x) : keys.add(x)));
          else if (sg !== "some") { g.keys.forEach((x) => keys.delete(x)); keys.add(k); }
          else keys.has(k) ? keys.delete(k) : keys.add(k);
          p.set(keys); o.onChange();
        }));
      },
    };
    return p;
  }
  const PP = makePicker({ st: S.pick, showKey: "bookShow", chsKey: "pickChs", cols: setCols, keys: colKeys, bar: $("#pickBar"), rows: $("#pickChs"),
    dot: (k) => (S.sets.some((s) => S.selected.has(s.id) && unitKey(s) === k) ? `<span class="dot pick" title="Has picked sets">•</span>` : ""),
    onChange: () => renderSetup() });
  const chShown = (s) => PP.has(unitKey(s));
  // Both pages share one Collection / Course switch.
  function syncGroupSegs() {
    for (const id of ["#groupSeg", "#tGroupSeg"]) {
      $(id).hidden = !S.courses.length;
      $(id).querySelectorAll("[data-group]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.group === (courseMode() ? "course" : "book")));
    }
  }
  document.querySelectorAll("[data-group]").forEach((b) => (b.onclick = () => { S.groupBy = b.dataset.group; store.set("groupBy", S.groupBy); renderSetup(); renderTable(); }));
  function renderPickBar() {
    PP.render(); syncGroupSegs();
    const n = S.selected.size;
    $("#pickSumRow").hidden = !n;
    $("#pickSum").textContent = `${n} set${n === 1 ? "" : "s"} picked`;
  }
  // The Filter row: every tag in use, each with how many sets picking it hides (the sets without it), most hidden first.
  // None is picked to start, so every set shows. It's left out when no tag would narrow anything.
  function renderTagRow(tags, on) {
    $("#pickTagRow").hidden = tags.every((t) => t.n === S.sets.length);
    $("#pickTags").innerHTML = tags.map((t) => `<button class="chip" type="button" data-tag="${esc(t.key)}" aria-pressed="${on.includes(t.key)}" title="Hides ${S.sets.length - t.n} of ${S.sets.length} sets">${esc(t.name)}<span class="n">${S.sets.length - t.n}</span></button>`).join("")
      + (on.length ? `<button class="link small" type="button" id="tagClear">Clear filter</button>` : "");
    const save = () => { store.set("pickTags", [...S.pickTags]); renderSetup(); };
    $("#pickTags").querySelectorAll("[data-tag]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.tag;
      for (const x of [...S.pickTags]) if (!tags.some((t) => t.key === x)) S.pickTags.delete(x);
      S.pickTags.has(k) ? S.pickTags.delete(k) : S.pickTags.add(k); save();
    }));
    if (on.length) $("#tagClear").onclick = () => { S.pickTags.clear(); save(); };
  }
  $("#pickClear").onclick = () => { S.selected.clear(); saveSetup(); renderSetup(); };
  function renderSetup() {
    const box = $("#setPicker");
    if (!S.loaded) return;
    $("#pickBar").hidden = !S.sets.length;
    //#if public
    renderSampleNote();
    //#endif
    if (!S.sets.length) {
      //#if public
      if (samplesState) box.innerHTML = `<div class="empty"><b>${samplesState === "adding" ? "Adding the sample sets…" : "Loading your sets…"}</b></div>`;
      else {
        box.innerHTML = `<div class="empty"><b>No vocab sets yet.</b><span>Import a vocab file someone shared with you, or type your own sets into the vocab table.</span><span class="tactions" style="justify-content:center"><button class="btn primary" type="button" id="emptyImport">Import a file…</button><button class="btn" type="button" id="emptyTable">Open the vocab table</button></span><button class="link" type="button" id="emptySamples">Add the sample sets</button></div>`;
        $("#emptyImport").onclick = () => { openSettings(); $("#importBtn").click(); };
        $("#emptyTable").onclick = () => { renderTable(); show("table"); };
        $("#emptySamples").onclick = (e) => { e.target.disabled = true; addSamples().catch(() => { e.target.disabled = false; banner("The sample sets couldn't be added. Try again."); }); };
      }
      //#else
      box.innerHTML = `<div class="empty"><b>No vocab sets yet.</b><span>${canWrite ? "Add your first set in the vocab table." : "The owner hasn't added any sets yet."}</span></div>`;
      //#endif
    } else {
      // Sets with no ready words can't be picked.
      for (const s of S.sets) if (!readyCount(s.words)) S.selected.delete(s.id);
      // Older pages stored bare chapter numbers: read them as chapters of the first collection.
      const pk = S.pick.picks, has = (k) => S.sets.some((s) => unitKey(s) === k);
      for (const c of [...pk]) if (!c.includes("\u0001")) { pk.delete(c); pk.add(`${cols()[0]}\u0001${oldUnit(c)}`); }
      for (const c of [...pk]) { const k = newKey(c, has); if (k !== c) { pk.delete(c); pk.add(k); } }
      for (const k of pk) if (!has(k)) pk.delete(k);
      // Pages before v40 showed one book (or a chosen few) at a time: carry that view over once, as unit picks.
      if (S.oldBooks) {
        const was = setCols().filter((b) => S.oldBooks.includes(b));
        if (was.length && was.length < setCols().length) {
          const keep = new Set(was.flatMap((b) => { const ks = colKeys(b).filter((k) => S.pick.picks.has(k)); return ks.length ? ks : colKeys(b); }));
          S.pick.picks = keep; store.set("pickChs", [...keep]);
        }
        S.oldBooks = null; store.set("pickBooks", null); store.set("pickBook", null);
      }
      // Pages before v42 kept only pickChs, where none meant every chapter: read each collection's picks as its state, once.
      if (S.pick.show == null) {
        const any = S.pick.picks.size > 0, show = {};
        for (const b of setCols()) { const ks = PP.picksOf(b); show[b] = !any || ks.length === colKeys(b).length ? "all" : ks.length ? "some" : "none"; if (show[b] === "all") ks.forEach((k) => S.pick.picks.delete(k)); }
        PP.replace(show, S.pick.picks);
      }
      const multi = setCols().length > 1, states = setCols().map(PP.state);
      // Picked tags that no set has any more are ignored, so they can't hide everything.
      const tags = tagCounts(), on = [...S.pickTags].filter((k) => tags.list.some((t) => t.key === k));
      const tagged = (s) => !on.length || setTags(s, tags.kinds).some((t) => on.includes(tagKey(t)));
      const chs = new Set(S.sets.filter(chShown).map(unitKey)), shown = S.sets.filter((s) => chShown(s) && tagged(s));
      renderTagRow(tags.list, on);
      renderPickBar();
      const byCh = new Map();
      for (const s of shown) { if (!byCh.has(unitKey(s))) byCh.set(unitKey(s), []); byCh.get(unitKey(s)).push(s); }
      const groups = [...byCh.values()];
      const onNames = tags.list.filter((t) => on.includes(t.key)).map((t) => `“${esc(t.name)}”`);
      const who = chs.size === 1 ? esc(keyUnit([...chs][0])) + " has" : states.every((x) => x === "all") ? "There are" : "These units have";
      box.innerHTML = !shown.length
        ? !chs.size ? `<div class="empty"><span>No units picked. Tap All or a unit above to see its sets.</span></div>`
        : `<div class="empty"><b>No sets to show.</b><span>${who} no sets tagged ${onNames.join(" or ")}. Clear the filter above to see the rest.</span></div>`
        : groups.map((sets, i) => {
        const name = esc(sets[0].unit);
        const usable = sets.filter((s) => readyCount(s.words)), all = usable.length && usable.every((s) => S.selected.has(s.id));
        return `<div class="chapter"><div class="chrow"><b>${multi ? `${esc(colLabel(colOf(sets[0])))} › ${name}` : name}</b>${usable.length ? `<button class="link" data-all="${i}">${all ? "Clear" : "Select all"}</button>` : ""}</div>
          <div class="chips">${sets.map((s) => { const n = readyCount(s.words); return `<button class="chip" data-set="${esc(s.id)}" aria-pressed="${!!n && S.selected.has(s.id)}"${n ? "" : ` disabled title="No words yet"`}>${esc(s.name)}<span class="n">${n}</span></button>`; }).join("")}</div></div>`;
      }).join("");
      box.querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => { const id = b.dataset.set; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); saveSetup(); renderSetup(); }));
      box.querySelectorAll("[data-all]").forEach((b) => (b.onclick = () => {
        const sets = groups[+b.dataset.all].filter((s) => readyCount(s.words));
        const all = sets.every((s) => S.selected.has(s.id));
        sets.forEach((s) => (all ? S.selected.delete(s.id) : S.selected.add(s.id))); saveSetup(); renderSetup();
      }));
    }
    document.querySelectorAll("#dirSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.dir === S.dir));
    // Verb forms only works English → 日本語.
    if (S.mode === "verb" && S.dir !== "ej") S.mode = "default";
    $("#mode-verb").disabled = S.dir !== "ej";
    document.querySelectorAll("#modeSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === S.mode));
    document.querySelectorAll("#modeSeg [data-mode] span").forEach((sp) => (sp.textContent = MODE_TEXT[S.dir][sp.parentNode.dataset.mode]));
    const n = selectedWords().length, items = S.dir === "both" ? n * 2 : n;
    const kata = S.mode === "kata" ? "katakana " : "";
    $("#countLbl").textContent = n && S.mode === "verb" ? `${n} verb${n === 1 ? "" : "s"}, ${n * VFORMS.length} questions`
      : !n && S.mode === "verb" && S.selected.size ? "No verbs in the picked set(s)."
      : n ? `${n} ${kata}word${n === 1 ? "" : "s"}${S.dir === "both" ? `, ${items} questions` : ""}`
      : kata && S.selected.size ? "No katakana words in the picked set(s)." : "Pick at least one set.";
    $("#startBtn").disabled = !n;
    renderResume();
    renderUpto();
  }
  // "Kanji learned up to" picks one unit's kanji list (collection + unit); every list before it, earlier collections included, counts as learned.
  function renderUpto() {
    const sel = $("#uptoSel"), lists = S.kanjiLists, multi = multiCol();
    const opts = lists.length
      ? [["auto", ["Highest picked unit"]], ...new Map(lists.map((k) => [unitKey(k), [k.unit, colOf(k)]])), ["none", ["Nothing yet"]], ["all", ["Every kanji in the table"]]]
      : [["all", ["Every kanji in the table"]]];
    // Older pages stored a bare chapter number (read as that chapter of the first collection) or a chapter number after the book.
    const has = (k) => opts.some(([v]) => v === k);
    if (S.upto && !has(S.upto) && !S.upto.includes("\u0001") && has(`${cols()[0]}\u0001${oldUnit(S.upto)}`)) S.upto = `${cols()[0]}\u0001${oldUnit(S.upto)}`;
    if (S.upto) S.upto = newKey(S.upto, has);
    // With no kanji lists (yet: they can load after the sets, or be added later) the choice is kept for when they come.
    if (lists.length && !opts.some(([v]) => v === S.upto)) S.upto = unitKey(lists[lists.length - 1]);
    const cur = lists.length ? S.upto : "all";
    // With more than one collection, each unit names its collection so the closed menu reads "Nakama 2 › Ch. 3".
    const opt = ([v, [l, b]]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(multi && b != null ? `${colLabel(b)} › ${l}` : l)}</option>`;
    sel.innerHTML = opts.map(opt).join("");
    const set = learnedSet(), key = uptoKey(), list = lists.find((k) => unitKey(k) === key);
    const upTo = S.upto !== "auto" ? "" : !S.selected.size ? "Follows the sets you pick" : list ? `Up to ${unitTitle(list)} · ` : "";
    $("#uptoHint").textContent = !lists.length ? "Add kanji lists to units in the vocab table to choose a unit." : S.upto === "auto" && !S.selected.size ? upTo : set ? `${upTo}${set.size} kanji learned` : "";
  }
  $("#uptoSel").onchange = (e) => { S.upto = e.target.value; store.set("uptoPick", S.upto); renderUpto(); };
  // The list "Highest picked unit" stands for: the last kanji list at or before the furthest picked unit
  // (collection order, then unit). No picks = every list; picks before the first list = none.
  function uptoKey() {
    if (S.upto !== "auto") return S.upto;
    const after = sortLists;
    let top = null;
    for (const s of S.sets) if (S.selected.has(s.id) && (!top || after(s, top) > 0)) top = s;
    if (!top) return "all";
    const ok = S.kanjiLists.filter((k) => after(k, top) <= 0);
    return ok.length ? unitKey(ok[ok.length - 1]) : "none";
  }
  function saveSetup() { store.set("selected", [...S.selected]); store.set("dir", S.dir); store.set("mode", S.mode); }
  document.querySelectorAll("#dirSeg button").forEach((b) => (b.onclick = () => { S.dir = b.dataset.dir; saveSetup(); renderSetup(); }));
  document.querySelectorAll("#modeSeg button").forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; saveSetup(); renderSetup(); }));
  $("#toTable").onclick = () => { renderTable(); show("table"); };
  $("#backBtn").onclick = () => show("setup");

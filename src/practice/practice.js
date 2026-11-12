  // ---------- quiz ----------
  const Q = { items: [], queue: [], wrong: [], round: 1, cur: null, tries: {}, busy: false, answered: false, total: 0, done: new Set(), meta: null };
  // The "Kanji learned up to" list the practice in progress counts, fixed when it starts (a resumed one keeps its own).
  let quizUpto = null;
  function startTest(words, upto = uptoKey()) {
    quizUpto = upto;
    const items = [];
    for (const w of words) {
      // Verb forms: five questions per verb, or the one form a "practice again" word already is.
      if (S.mode === "verb") { if (w.vf) items.push({ key: w.id, dir: "ej", vid: w.vid, w }); else items.push(...verbItems(w)); continue; }
      if (S.dir !== "je") items.push({ key: w.id + ":ej", dir: "ej", w });
      if (S.dir !== "ej") items.push({ key: w.id + ":je", dir: "je", w });
    }
    // Word ids are only sure to be unique within a set (a hand-made file may number each set's words 1, 2, …): a question
    // whose key is already taken gets its own, so tries and progress stay per question.
    const keys = new Set();
    for (const it of items) { let k = it.key, n = 2; while (keys.has(k)) k = `${it.key}#${n++}`; keys.add(k); it.key = k; }
    Object.assign(Q, { items, queue: order(items), wrong: [], round: 1, tries: {}, done: new Set(), total: items.length,
      meta: { dir: S.dir, mode: S.mode, sets: [...new Set(words.map((w) => w.set))] } });
    show("quiz");
    nextItem();
  }
  // A verb's forms stay together and in order (Current Plain+ first); the verbs themselves come shuffled.
  function order(items) {
    if (!items.some((it) => it.vid)) return shuffle(items);
    const g = new Map();
    for (const it of items) { if (!g.has(it.vid)) g.set(it.vid, []); g.get(it.vid).push(it); }
    return shuffle([...g.values()]).flat();
  }
  $("#startBtn").onclick = () => startTest(selectedWords());
  $("#quitBtn").onclick = () => { saveResume(); show("setup"); renderSetup(); };
  // The practice in progress is saved after every question (choice "resume", which follows the account like the others),
  // so one left midway can be picked up again from the practice page. Finishing clears it; starting another replaces it.
  function saveResume() {
    clearTimeout(inkTimer);
    if (!Q.meta) return;
    // The question on screen stays to do until it's marked right or wrong (the self-marking panel may still be waiting).
    const open = Q.cur && !Q.done.has(Q.cur.key) && !Q.wrong.includes(Q.cur);
    const pending = [...(open ? [Q.cur] : []), ...Q.queue];
    const r = { items: Q.items, pending: pending.map((it) => it.key), wrong: Q.wrong.map((it) => it.key), done: [...Q.done], tries: Q.tries, round: Q.round, meta: Q.meta, upto: quizUpto, savedAt: new Date().toISOString() };
    // What's written for the question still open comes back too.
    if (open && (!main.empty || !furi.empty)) r.ink = { key: Q.cur.key, main: inkOf(main), furi: inkOf(furi) };
    // A very long practice (thousands of questions) isn't kept, so saving stays quick.
    store.set("resume", JSON.stringify(r).length < 400000 ? r : null);
  }
  // A box's strokes, with its size (to fit them into a smaller box on another device) and which strokes are the two
  // parts of one that crossed between the boxes (g, so Undo still takes both). Points are one flat list (x, y, x, y…):
  // Firestore can't store a list inside a list, and the whole choices document would fail to save.
  const flatXY = (st) => st.flatMap(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2]);
  const inkOf = (pad) => ({ w: pad.w, h: pad.h, s: pad.strokes.filter((st) => st.length && st !== pad.cur).map((st) => ({ g: st.gid, p: flatXY(st) })) });
  function restoreInk(ink) {
    const gids = new Map();
    for (const [pad, k] of [[furi, "furi"], [main, "main"]]) {
      const d = ink[k];
      if (!d?.s?.length || !pad.w) continue;
      const f = Math.min(1, pad.w / (d.w || pad.w), pad.h / (d.h || pad.h));
      for (const { g, p } of d.s) {
        if (!Array.isArray(p) || !p.length) continue;
        const pts = typeof p[0] === "number" ? Array.from({ length: p.length >> 1 }, (_, i) => [p[2 * i], p[2 * i + 1]]) : p; // pairs: saved before Oct 21
        const st = pts.map(([x, y]) => [x * f, y * f]);
        if (!gids.has(g)) { gids.set(g, ++gidSeq); history.push({ gid: gidSeq }); }
        st.gid = gids.get(g);
        pad.strokes.push(st);
      }
      pad.draw(); pad.onChange();
    }
  }
  // Saved again shortly after each stroke, so the writing survives closing the page too.
  function inkChanged() { clearTimeout(inkTimer); if (Q.cur && !Q.answered && !$("#quiz").hidden) inkTimer = setTimeout(saveResume, 600); }
  const resumable = () => { const r = store.get("resume", null); return Array.isArray(r?.items) && r.items.length && Array.isArray(r.pending) ? r : null; };
  function renderResume() {
    const r = resumable(), b = $("#resumeBtn");
    b.hidden = !r;
    if (r) { b.innerHTML = `Resume last practice<span class="n">${r.items.length - (r.done || []).length} left</span>`; b.title = (r.meta?.sets || []).join(", "); }
  }
  $("#resumeBtn").onclick = () => {
    const r = resumable();
    if (!r) return renderResume();
    const by = new Map(r.items.map((it) => [it.key, it])), pick = (ks) => (ks || []).map((k) => by.get(k)).filter(Boolean);
    // It goes on in its own direction and mode.
    if (DIRS[r.meta?.dir]) S.dir = r.meta.dir;
    if (MODES[r.meta?.mode]) S.mode = r.meta.mode;
    saveSetup();
    quizUpto = r.upto ?? uptoKey();
    Object.assign(Q, { items: r.items, queue: pick(r.pending), wrong: pick(r.wrong), round: r.round || 1, tries: r.tries || {}, done: new Set(r.done || []), total: r.items.length,
      meta: r.meta || { dir: S.dir, mode: S.mode, sets: [] } });
    show("quiz");
    nextItem();
    if (r.ink && r.ink.key === Q.cur?.key) { pads.forEach((p) => p.resize()); restoreInk(r.ink); saveResume(); }
  };

  function nextItem() {
    if (!Q.queue.length) {
      if (!Q.wrong.length) return finish();
      Q.round++; Q.queue = order(Q.wrong); Q.wrong = [];
    }
    Q.cur = Q.queue.shift(); Q.answered = false; Q.busy = false;
    const { w, dir } = Q.cur;
    $("#feedback").hidden = true; $("#tools").hidden = false; $("#checkErr").hidden = true;
    //#if public
    $("#selfCheck").hidden = true;
    //#endif
    main.c.classList.remove("locked"); furi.c.classList.remove("locked");
    furi.clear(); main.clear(); scratch.clear(); history.length = 0; setErasing(false);
    $("#qTag").textContent = w.set + (Q.round > 1 ? ` · round ${Q.round}` : "");
    const qt = $("#qText");
    if (dir === "ej") {
      qt.className = "qtext"; qt.textContent = w.ven || w.en;
      $("#qSub").className = "qsub" + (w.vf ? " vform" : ""); $("#qSub").textContent = w.vf || "";
      $("#furiLabel").hidden = false; furi.c.hidden = false; $("#mainLabel").parentNode.hidden = true; $("#mainTag").textContent = "答え (answer)";
    } else {
      const jp = shownJp(w);
      qt.className = "qtext jp"; qt.textContent = jp; $("#qSub").className = "qsub"; $("#qSub").textContent = KANJI.test(jp) && S.mode !== "kanji" ? w.kana : "";
      $("#furiLabel").hidden = true; furi.c.hidden = true; $("#mainLabel").parentNode.hidden = true; $("#mainTag").textContent = "English (answer)";
    }
    $("#progLbl").textContent = `${Q.done.size} of ${Q.total} done` + (Q.round > 1 ? ` · round ${Q.round}, ${Q.queue.length + 1} left to fix` : "");
    $("#meterFill").style.width = (Q.done.size / Q.total) * 100 + "%";
    syncCheck();
    saveResume();
    //#if public
    showRound();
    //#endif
    requestAnimationFrame(() => pads.forEach((p) => p.resize()));
  }

  // ---------- public site: built-in checker ----------
  // Compares the strokes with stroke templates from KanjiVG and the Hershey fonts (src/checking/checker.js) against every accepted way of writing
  // the answer, so it only has to decide "is this one of these?", never read arbitrary writing.
  let templates = null;
  function loadTemplates() {
    templates ||= dataFile("templates")
      .then((j) => window.QCardChecker.init(j))
      .catch(() => { templates = null; throw { code: "tpl_load" }; });
    return templates;
  }
  const strokesOf = (pad) => pad.strokes.filter((s) => s.length).map((s) => s.map(([x, y]) => [x, y]));
  // Main-box answers the page would accept with no furigana (Force kanji and Katakana only rules included).
  // A 〜 the set shows stays in, and the checker lets it be written or left out (〜さん: 〜さん or さん).
  function mainCands(w) {
    const out = new Set();
    for (const p of forms(w, true)) {
      out.add(p.kana);
      if (KANJI.test(p.kanji)) for (const m of [p.kanji, learnedForm(p), ...kanjiMixes(p)]) if (m) out.add(m);
    }
    return [...out].filter((m) => m && readMatches(w, { main: m, furigana: "" }) && (S.mode !== "kata" || kataOk(w, { main: m })));
  }
  // Furigana that could sit over a kanji form: the whole reading, or the readings of some of its kanji, in order.
  function furiCands(w) {
    const out = new Set();
    for (const p of forms(w)) {
      if (!KANJI.test(p.kanji)) continue;
      out.add(hira(p.kana));
      const runs = kanjiReadings(p);
      if (runs.length <= 6) for (let m = 1; m < 1 << runs.length; m++) out.add(runs.filter((_, i) => (m >> i) & 1).join(""));
    }
    return [...out].filter(Boolean);
  }
  const nth = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  const WRONG = "This doesn't look like the answer.";
  function whyNot(res) {
    const bad = (res.chars || []).map((c, i) => ({ ...c, i })).filter((c) => !c.ok), c = bad[0];
    if (!c) return WRONG;
    if (c.why === "small") return `「${c.ch}」 should be written small.`;
    if (c.why === "large") return `「${c.ch}」 should be full size.`;
    if (c.why === "missing") return `Something's missing: 「${c.ch}」.`;
    if (c.why === "extra") return "There's extra writing at the end.";
    if (c.why === "strokes") return { missing: `「${c.ch}」 is missing a stroke.`, extra: `「${c.ch}」 has an extra stroke.`, crossing: `Two strokes in 「${c.ch}」 should cross.` }[c.strokes] || `A stroke in 「${c.ch}」 doesn't belong there.`;
    return bad.length > 1 ? `${bad.length} characters don't match, starting with the ${nth(c.i + 1)} (「${c.ch}」).` : `The ${nth(c.i + 1)} character doesn't look like 「${c.ch}」.`;
  }
  // What the checker read, for "The checker read": each character that matched, its best guess for one that didn't
  // (？ when it has none; the character itself when only its strokes were off) and nothing for a missing one.
  const readOf = (res) => (res?.chars || []).map((c) => (c.ok || c.why === "strokes" ? c.ch : c.why === "missing" ? "" : c.got || "？")).join("");
  // { ok, r } like Claude's verdict, or null when the answer has characters the checker has no templates for.
  async function builtinCheck(w, hasFuri) {
    await loadTemplates();
    const C = window.QCardChecker;
    const fc = hasFuri ? furiCands(w) : [];
    const fr = fc.length ? C.verify({ strokes: strokesOf(furi), candidates: fc, box: { w: furi.w, h: furi.h }, anyKana: true }) : null;
    if (fr?.ok === null) return null;
    const res = C.verify({ strokes: strokesOf(main), candidates: mainCands(w), box: { w: main.w, h: main.h }, anyKana: S.mode !== "kata" });
    if (res.ok === null) return null;
    const r = { main: res.ok ? res.text : readOf(res), furigana: !fr ? "" : fr.ok ? fr.text : readOf(fr), reason: "" };
    const chars = { main: res.chars, furi: fr?.chars };
    if (!res.ok) return { ok: false, r: { ...r, reason: whyNot(res) }, chars };
    if (hasFuri && !fc.length) return { ok: false, r: { ...r, reason: "This word has no kanji, so it needs no furigana." }, chars };
    if (fr && !fr.ok) return { ok: false, r: { ...r, reason: "The furigana doesn't match the reading of this word." }, chars };
    const ok = readMatches(w, r) && !badFuri(w, r);
    // (the furigana rule only when there is furigana; otherwise the writing just isn't one of the word's forms)
    if (!ok) r.reason = r.furigana ? "Furigana goes only over kanji you wrote, as their reading." : WRONG;
    return { ok, r, chars };
  }
  // 日本語 → English: the meaning in any of the ways it may be written (englishAnswers). null when the checker can't read it.
  async function englishCheck(w) {
    await loadTemplates();
    const res = window.QCardChecker.verify({ strokes: strokesOf(main), candidates: window.QCardChecker.englishAnswers(w.en), box: { w: main.w, h: main.h }, latin: true });
    return res.ok === null ? null : { ok: res.ok, r: { main: res.ok ? res.text : readOf(res), furigana: "", reason: "" }, chars: { main: res.chars } };
  }
  // The one question both Check and the live reading ask: is what's written the answer to this word, this way round?
  const checkWriting = (w, dir) => (dir === "je" ? englishCheck(w) : builtinCheck(w, dir === "ej" && !furi.empty));
  const CHECK_ERR = {
    tpl_load: "Couldn't load the handwriting checker. Check your connection and press Check again.",
    other: "Something went wrong with the check. Press Check to try again.",
  };
  // What Check does with this answer (see check in checking/grading.js). The checker reads English → 日本語 answers, and
  // 日本語 → English answers written the way the meaning is worded. Other English (a synonym, say) and words it has no
  // strokes for are marked by the student (selfMark).
  async function judge({ w, dir }) {
    $("#liveRead").hidden = true;
    $("#overrideBtn").textContent = "The checker misread my writing, count it as correct";
    const res = await checkWriting(w, dir);
    return () => {
      if (res && !res.ok) showBoxes(res);
      shareAnswer(!res ? "unread" : res.ok ? "right" : dir === "ej" ? "wrong" : "unmatched", res?.r);
      if (res && (res.ok || dir === "ej")) grade(res.ok, res.r); else selfMark(!!res);
    };
  }
  // Developer tools (Settings), each off until turned on, in this browser:
  // - "Show what the checker reads as I write": a moment after each stroke, the reading the Check button would get,
  //   under the answer box, with the time the check took (it tells you before Check, so it's never on by default).
  // - "Show character boxes": a box around each character the checker found, after Check and with the live reading.
  let liveTimer = 0;
  const liveOn = () => !!store.get("liveRead", false), boxesOn = () => !!store.get("charBoxes", false);
  function showBoxes(res) {
    for (const [p, chars] of [[main, res?.chars?.main], [furi, res?.chars?.furi]]) {
      if (!boxesOn() && !p.marks) continue;
      p.marks = boxesOn() && chars ? chars.filter((c) => c.box).map((c) => ({ box: c.box, ok: c.ok, label: c.ok ? c.ch : c.got || "？" })) : null;
      p.draw();
    }
  }
  function liveRead() {
    clearTimeout(liveTimer);
    const el = $("#liveRead");
    if (!liveOn() || !Q.cur || Q.answered || Q.busy || main.empty) { el.hidden = true; return; }
    liveTimer = setTimeout(async () => {
      if (main.cur || furi.cur) return liveRead(); // not while a stroke is being drawn
      const cur = Q.cur, { w, dir } = cur;
      try {
        await loadTemplates();
        const t0 = performance.now();
        const res = await checkWriting(w, dir);
        const ms = Math.round(performance.now() - t0);
        if (Q.cur !== cur || Q.answered || Q.busy || main.empty) return;
        const r = res?.r || {}, read = readAs(r);
        const verdict = !res ? "it can't check this word" : res.ok ? "would pass" : dir === "je" ? "you'd mark it yourself" : "would fail" + (r.reason ? `: ${r.reason}` : "");
        el.textContent = `Reads ${read || "nothing"} · ${verdict} · ${ms} ms`;
        el.hidden = false;
        showBoxes(res);
      } catch { el.hidden = true; }
    }, 250);
  }
  // new ink: the boxes from the last reading no longer fit it
  for (const p of [main, furi]) { const was = p.onChange; p.onChange = () => { was(); if (p.marks) { p.marks = null; p.draw(); } liveRead(); }; }
  $("#liveReadOn").checked = liveOn();
  $("#liveReadOn").onchange = (e) => { store.set("liveRead", e.target.checked); liveRead(); };
  $("#charBoxesOn").checked = boxesOn();
  $("#charBoxesOn").onchange = (e) => store.set("charBoxes", e.target.checked);
  // 日本語 → English answers the checker couldn't match (unmatched), and words it can't read, are marked by the student.
  function selfMark(unmatched) {
    $("#selfHead").textContent = unmatched ? "The checker couldn't match this to the wording below. Did you mean the same thing?" : "Compare what you wrote with the answer.";
    Q.answered = true; syncCheck();
    lockPads();
    $("#tools").hidden = true; setErasing(false);
    writeAnswer($("#selfAnswer"));
    $("#selfCheck").hidden = false;
    requestAnimationFrame(() => $("#selfCheck").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }));
  }
  $("#selfGot").onclick = () => { $("#selfCheck").hidden = true; grade(true, null); };
  $("#selfMiss").onclick = () => { $("#selfCheck").hidden = true; grade(false, { reason: "You marked this one as missed." }); $("#overrideBtn").hidden = true; };


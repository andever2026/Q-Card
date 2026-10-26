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
    const left = Q.total - Q.done.size;
    $("#progLbl").textContent = `${Q.done.size} of ${Q.total} done` + (Q.round > 1 ? ` · round ${Q.round}, ${Q.queue.length + 1} left to fix` : "");
    $("#meterFill").style.width = (Q.done.size / Q.total) * 100 + "%";
    syncCheck();
    saveResume();
    requestAnimationFrame(() => pads.forEach((p) => p.resize()));
  }

  function rulesFor(w) {
    const hasKanji = !!(w.kanji && /[一-鿿々]/.test(w.kanji));
    const req = requiredKanji(w), free = [...new Set([...w.kanji].filter((c) => KANJI.test(c) && !req.includes(c)))];
    const furiNote = " FURIGANA: furigana normally covers ONLY the kanji characters, so for 食べる writing just た above 食 is correct and complete, for 飲む just の above 飲, and for 申し込む もう above 申 and こ above 込 (or just one of them). Furigana over the whole word is also fine. Never mark an answer wrong because the furigana leaves out the okurigana or other kana already written in the main box; check that the furigana is the right reading for the kanji it sits over. Anything written in the furigana strip must be a correct reading of the characters directly below it: furigana over kana (for example あ over お) is WRONG unless it repeats that same kana, and any wrong, extra or meaningless furigana makes the whole answer wrong.";
    const base = "If the main box uses kanji: when there is furigana in the strip, BOTH the kanji and the furigana reading must be correct; when the strip is empty, it is correct if the kanji and the whole word (including okurigana) are correct. If the main box is written fully in kana, it is correct if the kana spelling matches the expected reading exactly.";
    if (S.mode === "kata") {
      const runs = kataRuns(w.kana);
      return `KATAKANA MODE: the parts of the expected answer written in katakana (${runs.join(" ")}) MUST be written in katakana. Writing any of them in hiragana is WRONG, and so is writing hiragana parts in katakana. The long vowel mark ー, small ッ ャ ュ ョ ァ ィ ゥ ェ ォ, and dakuten/handakuten must all match. A few katakana look almost the same as hiragana by hand (ヘ/へ, ベ/べ, ペ/ぺ, リ/り): where the expected answer has the katakana one, read it as katakana. ${hasKanji ? "Writing kanji is optional for this word. " : ""}` + base + furiNote;
    }
    if (S.mode === "kana") return "KANA-ONLY MODE: judge only the reading. If kanji was written and furigana is present, judge only the furigana and ignore any mistakes in the kanji. If kanji was written with no furigana, judge the reading the written word stands for. If the answer is in kana, judge the kana spelling. Never mark down wrong or missing kanji." + furiNote;
    if (S.mode === "kanji" && req.length) return `FORCE-KANJI MODE: the student has learned these kanji, so they MUST be written as kanji: ${req.join(" ")}${/[／/]/.test(w.kanji) ? " (only the ones that appear in the alternative the student chose)" : ""}. Writing any of them in kana is WRONG.${free.length ? ` These kanji have NOT been learned yet, so writing their part in kana is fine (writing them as correct kanji is fine too): ${free.join(" ")}.` : ""} Then: ${base}` + furiNote;
    if (S.mode === "kanji" && hasKanji) return "None of this word's kanji have been learned yet, so kana is fine and correct kanji are fine too. " + base + furiNote;
    return (hasKanji ? "Writing kanji is optional for this word. " : "This word is normally written in kana. ") + base + furiNote;
  }
  // The textbook's notation inside the expected answer, explained only when the word uses it.
  function notation(w) {
    const t = (w.kana || "") + (w.kanji || ""), out = [];
    if (/[（(]/.test(t)) out.push("Parentheses mark an optional part: （お）てんき accepts おてんき or てんき, and きれい（な） accepts きれい or きれいな.");
    if (/[／/]/.test(t)) out.push("／ separates alternatives: writing any one of them is correct, and so is writing several or all of them separated by ／ the way the expected answer lists them (in the main box or in the furigana), as long as each one is an allowed alternative.");
    if (/[〜～]/.test(t)) out.push("〜 marks a slot for another word: the student may write 〜, leave it out, or fill it with a suitable word. A handwritten 〜 is a single wavy stroke and is easy to mistake for い, ー, へ or ~. When a mark like that sits where the expected answer has 〜, it IS the 〜: write it as 〜 in MAIN and do not count it as an extra character.");
    return out.length ? "\nNotation in the expected answer: " + out.join(" ") : "";
  }
  function buildPrompt(w, dir, hasFuri) {
    if (dir === "je") {
      const jp = shownJp(w);
      return `You are grading a handwritten answer on a university Japanese vocabulary quiz (Nakama 1 textbook).
The student saw the Japanese word: ${jp}${KANJI.test(jp) ? ` (reading: ${w.kana})` : ""}${w.kanji && jp !== w.kanji ? ` (textbook form: ${w.kanji})` : ""}
Expected English meaning: "${w.en}"
The attached image is the student's handwritten English answer (black ink on white, written with a finger, mouse or stylus).
Mark it correct if it conveys the same meaning as the expected English. Accept close synonyms, small spelling mistakes, a missing "to" on verbs, and missing articles. Mark it wrong if the meaning is different or only partly right.
Reply in exactly this format, four lines, nothing else:
MAIN: <what you read in the image>
FURIGANA: NONE
CORRECT: <YES or NO>
REASON: <one short English sentence; if wrong, say what the meaning should be>`;
    }
    return `You are grading a handwritten answer on a university Japanese vocabulary quiz (Nakama 1 textbook). The test is English → Japanese, written by hand.
The student saw: "${w.ven || w.en}"${w.vf ? `, and was asked for its ${VDESC[w.vf]}. The expected answer below is that form; any other form of the verb is WRONG.` : ""}
Expected answer: reading (kana) = ${w.kana}${w.kanji ? `; full kanji form = ${w.kanji}. Writing some of the kanji in kana instead (for example よう食 for 洋食) is a valid way to write the word, as long as each part is correct; the grading rule below says whether a specific kanji is required` : "; no kanji form"}.${notation(w)}
${hasFuri ? "Image 1 shows the whole answer sheet as the student saw it: the furigana strip on top, a dashed separator, and the main answer box below. Furigana sits directly above the characters it belongs to. Image 2 is the furigana strip alone, enlarged, so the small kana are easier to read. Small or light strokes in the strip are almost certainly kana: read them carefully before calling anything a stray mark." : "Image 1 is the main answer box. The furigana strip above the box was left EMPTY."}
Read the handwriting, then judge from what you read. The student writes with a finger, mouse or stylus, so the writing is rough: NEVER mark an answer wrong for neatness, stroke shape, proportions, joined or separated strokes, or stroke order. If a character can reasonably be read as the expected one, it is correct. Mark a character wrong only when it is actually a different character, for example ソ/ン, シ/ツ, ぬ/め, わ/れ/ね, missing or extra dakuten/handakuten, wrong or missing small っ ゃ ゅ ょ, and wrong long vowels (e.g. おう vs おお). Hiragana vs katakana matters: the script must match the expected word. Only the expected word counts; a different word with a similar meaning is wrong. Your "correct" value must agree with your own transcription: if what you put in "main" and "furigana" is right under the grading rule, "correct" is true.
Grading rule: ${rulesFor(w)}
Reply in exactly this format, four lines, nothing else:
MAIN: <exactly what you read in the main box>
FURIGANA: <only the kana you read in the furigana strip, left to right, a space between groups; or NONE>
REASON: <one short English sentence; if wrong, name the exact mistake>
CORRECT: <YES or NO, matching your REASON>`;
  }

  const ERR = {
    not_granted: "Checking needs permission to use Claude. Allow it from this page's permission menu, then try again.",
    sampling_disabled: "Claude isn't available on this account, so answers can't be checked.",
    rate_limited: "Claude is busy or you've hit a usage limit. Wait a moment and press Check again.",
    session_expired: "Your claude.ai session expired. Sign in again, then press Check.",
    images_unavailable: "This view can't send handwriting to Claude. Try opening the page in claude.ai in a browser.",
    invalid_json: "Claude's answer came back in the wrong format. Press Check again.",
    //#if public
    tpl_load: "Couldn't load the handwriting checker. Check your connection and press Check again.",
    //#endif
  };
  // A check still running when the student quits (or a practice started or resumed meanwhile) belongs to a question that's
  // no longer on screen: its answer stays unchecked, kept for Resume with what was written.
  const gone = (cur) => Q.cur !== cur || $("#quiz").hidden;
  //#if claude
  async function check() {
    if (main.empty || Q.busy) return;
    if (!sample) { showErr("Checking needs a signed-in claude.ai account. Open this page inside claude.ai."); return; }
    Q.busy = true; syncCheck(); $("#checking").hidden = false; $("#checkingFuri").hidden = furi.c.hidden; $("#checkErr").hidden = true;
    const cur = Q.cur, { w, dir } = cur;
    const hasFuri = dir === "ej" && !furi.empty;
    try {
      const imgs = hasFuri ? [await sheetBlob(), await furi.toBlob(4)] : [await main.toBlob()];
      const { text } = await sample(buildPrompt(w, dir, hasFuri), { images: imgs, cache: false });
      if (gone(cur)) return;
      const r = parseVerdict(text);
      const ok = dir === "ej" ? (r.correct || readMatches(w, r)) && !badFuri(w, r) && (S.mode !== "kata" || kataOk(w, r)) : r.correct;
      grade(ok, r);
    } catch (e) {
      if (!gone(cur)) showErr(ERR[e?.code] || "Couldn't reach Claude. Press Check to try again.");
    } finally {
      Q.busy = false; $("#checking").hidden = $("#checkingFuri").hidden = true; syncCheck();
    }
  }
  //#else
  // The built-in checker reads English → 日本語 answers, and 日本語 → English answers written the way the meaning is
  // worded. Other English (a synonym, say) and words it has no strokes for are marked by the student (selfMark).
  async function check() {
    if (main.empty || Q.busy) return;
    const cur = Q.cur, { w, dir } = cur;
    Q.busy = true; syncCheck(); $("#checking").hidden = false; $("#checkingFuri").hidden = furi.c.hidden; $("#checkErr").hidden = true;
    $("#overrideBtn").textContent = "The checker misread my writing, count it as correct";
    let self = false;
    try {
      const res = dir === "je" ? await englishCheck(w) : await builtinCheck(w, dir === "ej" && !furi.empty);
      if (gone(cur)) return;
      shareAnswer(!res ? "unread" : res.ok ? "right" : dir === "ej" ? "wrong" : "unmatched", res?.r);
      if (res && (res.ok || dir === "ej")) grade(res.ok, res.r); else self = res ? "unmatched" : "unread";
    } catch (e) {
      if (!gone(cur)) showErr(ERR[e?.code] || "Something went wrong with the check. Press Check to try again.");
    } finally {
      Q.busy = false; $("#checking").hidden = $("#checkingFuri").hidden = true; syncCheck();
    }
    if (self) selfMark(self === "unmatched");
  }
  //#endif

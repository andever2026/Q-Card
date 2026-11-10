  // ---------- claude.ai copy: Claude reads the handwriting and gives the verdict ----------
  // (The public site's checker is checking/builtin.js. Each gives the Check button its `judge` and its CHECK_ERR.)
  // Pictures of the writing for Claude, black ink on white. paper: a white canvas w × h (in the pad's units) drawn at `scale`.
  function paper(w, h, scale) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    return [c, ctx];
  }
  const png = (c) => new Promise((res) => c.toBlob(res, "image/png"));
  // One pad's ink, cropped to the writing with a margin.
  function padBlob(pad, scale = 2) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of pad.strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const edge = 16;
    x0 = Math.max(0, x0 - edge); y0 = Math.max(0, y0 - edge); x1 = Math.min(pad.w, x1 + edge); y1 = Math.min(pad.h, y1 + edge);
    const [c, ctx] = paper(x1 - x0, y1 - y0, scale);
    ctx.translate(-x0 * scale, -y0 * scale); pad.paint(ctx, "#000", scale);
    return png(c);
  }
  // Strip and box stacked as on screen, so Claude sees which character each furigana sits over.
  function sheetBlob() {
    const scale = 2, gap = 14, w = Math.max(furi.w, main.w), h = furi.h + gap + main.h;
    let x0 = Infinity, x1 = -Infinity;
    for (const p of [furi, main]) for (const s of p.strokes) for (const [x] of s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    x0 = Math.max(0, x0 - 24); x1 = Math.min(w, x1 + 24);
    const [c, ctx] = paper(x1 - x0, h, scale);
    ctx.translate(-x0 * scale, 0);
    furi.paint(ctx, "#000", scale);
    const sy = (furi.h + gap / 2) * scale;
    ctx.strokeStyle = "#bbb"; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(x0 * scale, sy); ctx.lineTo(x1 * scale, sy); ctx.stroke(); ctx.setLineDash([]);
    ctx.translate(0, (furi.h + gap) * scale);
    main.paint(ctx, "#000", scale);
    return png(c);
  }

  // What each verb form is called when Claude is asked for it.
  const VDESC = { "Current Plain+": "plain non-past affirmative (dictionary) form", "Current Plain-": "plain non-past negative form (〜ない)", "て form": "て form", "Past Plain+": "plain past affirmative form (〜た)", "Past Plain-": "plain past negative form (〜なかった)" };
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
Read the handwriting, then judge from what you read. The student writes with a finger, mouse or stylus, so the writing is rough: NEVER mark an answer wrong for neatness, stroke shape, proportions, joined or separated strokes, or stroke order. If a character can reasonably be read as the expected one, it is correct. Mark a character wrong only when it is actually a different character, for example ソ/ン, シ/ツ, ぬ/め, わ/れ/ね, missing or extra dakuten/handakuten, wrong or missing small っ ゃ ゅ ょ, and wrong long vowels (e.g. おう vs おお). Also wrong: a stroke that clearly passes through another stroke where the printed character has them only meet, or the reverse, the way a teacher would mark it. For example, in 北 the left half's short horizontal stroke and rising stroke both stop at its vertical stroke; drawn through to the right of that vertical, the character is wrong. A slight overshoot or a small gap from writing fast is fine. Hiragana vs katakana matters: the script must match the expected word. Only the expected word counts; a different word with a similar meaning is wrong. Your "correct" value must agree with your own transcription: if what you put in "main" and "furigana" is right under the grading rule, "correct" is true.
Grading rule: ${rulesFor(w)}
Reply in exactly this format, four lines, nothing else:
MAIN: <exactly what you read in the main box>
FURIGANA: <only the kana you read in the furigana strip, left to right, a space between groups; or NONE>
REASON: <one short English sentence; if wrong, name the exact mistake>
CORRECT: <YES or NO, matching your REASON>`;
  }
  // Plain labelled lines survive quotes and kana in the reason far better than JSON does.
  function parseVerdict(text) {
    const get = (k) => ((String(text).match(new RegExp("^[\\s*_-]*" + k + "[\\s*_]*[:：][\\s*_]*(.*)$", "im")) || [])[1] || "").replace(/\*+$/, "").trim();
    const c = get("CORRECT").toLowerCase();
    if (!/^(yes|no|true|false)/.test(c)) throw { code: "invalid_json" };
    const clean = (s) => { s = s.replace(/^[「"']+|[」"']+$/g, "").trim(); return /^(none|empty|n\/a|-)?$/i.test(s) ? "" : s; };
    // Claude sometimes notes where each reading sits ("あめ (above 雨), すく (above 少)"); only the kana are what was written.
    const kanaOnly = (s) => s.replace(/[（(][^）)]*[）)]/g, " ").replace(/[^\u3040-\u30ff／/]+/g, " ").replace(/\s+/g, " ").trim();
    return { main: clean(get("MAIN")), furigana: kanaOnly(clean(get("FURIGANA"))), correct: /^(yes|true)/.test(c), reason: get("REASON") };
  }

  const CHECK_ERR = {
    signed_out: "Checking needs a signed-in claude.ai account. Open this page inside claude.ai.",
    not_granted: "Checking needs permission to use Claude. Allow it from this page's permission menu, then try again.",
    sampling_disabled: "Claude isn't available on this account, so answers can't be checked.",
    rate_limited: "Claude is busy or you've hit a usage limit. Wait a moment and press Check again.",
    session_expired: "Your claude.ai session expired. Sign in again, then press Check.",
    images_unavailable: "This view can't send handwriting to Claude. Try opening the page in claude.ai in a browser.",
    invalid_json: "Claude's answer came back in the wrong format. Press Check again.",
    other: "Couldn't reach Claude. Press Check to try again.",
  };
  // What Check does with this answer (see check in checking/grading.js): Claude reads the pictures, and its verdict is graded.
  async function judge({ w, dir }) {
    if (!sample) throw { code: "signed_out" };
    const hasFuri = dir === "ej" && !furi.empty;
    const imgs = hasFuri ? [await sheetBlob(), await padBlob(furi, 4)] : [await padBlob(main)];
    const { text } = await sample(buildPrompt(w, dir, hasFuri), { images: imgs, cache: false });
    const r = parseVerdict(text);
    const ok = dir === "ej" ? (r.correct || readMatches(w, r)) && !badFuri(w, r) && (S.mode !== "kata" || kataOk(w, r)) : r.correct;
    return () => grade(ok, r);
  }

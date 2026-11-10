  // ---------- the Check button ----------
  function showErr(m) { const el = $("#checkErr"); el.textContent = m; el.hidden = false; }
  // A check still running when the student quits (or a practice started or resumed meanwhile) belongs to a question that's
  // no longer on screen: its answer stays unchecked, kept for Resume with what was written.
  const gone = (cur) => Q.cur !== cur || $("#quiz").hidden;
  // One Check for both versions of the page. Reading the writing is each version's own: `judge` (Claude in
  // checking/claude.js, the built-in checker in checking/builtin.js) answers with what to do once the page is no longer
  // busy, and CHECK_ERR has that version's messages for what can go wrong.
  async function check() {
    if (main.empty || Q.busy) return;
    const cur = Q.cur;
    Q.busy = true; syncCheck(); $("#checking").hidden = false; $("#checkingFuri").hidden = furi.c.hidden; $("#checkErr").hidden = true;
    let then = null;
    try { then = await judge(cur); }
    catch (e) { if (!gone(cur)) showErr(CHECK_ERR[e?.code] || CHECK_ERR.other); }
    finally { Q.busy = false; $("#checking").hidden = $("#checkingFuri").hidden = true; syncCheck(); }
    if (then && !gone(cur)) then();
  }
  $("#checkBtn").onclick = check;

  // Once an answer is checked, the pads take no more ink and a reading that was held back shows.
  function lockPads() {
    const { w, dir } = Q.cur;
    main.c.classList.add("locked"); furi.c.classList.add("locked");
    // Force kanji hides the reading of 日本語 → English questions until the answer is checked.
    if (dir === "je") $("#qSub").textContent = KANJI.test($("#qText").textContent) ? w.kana : "";
  }
  // The right answer, written into el: the word with its reading above it, or the English.
  function writeAnswer(el) {
    const { w, dir } = Q.cur;
    if (dir === "ej") { el.className = "answer"; el.innerHTML = w.kanji ? `<ruby>${esc(w.kanji)}<rt>${esc(w.kana)}</rt></ruby>` : esc(w.kana); }
    else { el.className = "answer en"; el.textContent = w.en; }
  }
  // What a checker made of the writing: "furigana 「ほく」 over 「北」", or "" when it read nothing.
  const readAs = (r) => [r?.furigana ? `furigana 「${r.furigana}」` : "", r?.main ? `「${r.main}」` : ""].filter(Boolean).join(" over ");

  function grade(ok, r) {
    const { key, w, dir } = Q.cur;
    Q.tries[key] = (Q.tries[key] || 0) + 1;
    Q.answered = true; syncCheck();
    lockPads();
    // A right answer goes straight on to the next word (the 花丸 that used to be drawn first was taken out, 2026-10-23).
    if (ok) { Q.done.add(key); saveResume(); nextItem(); return; }
    Q.wrong.push(Q.cur); saveResume();
    $("#tools").hidden = true;
    $("#fbReason").textContent = r?.reason || "";
    writeAnswer($("#fbAnswer"));
    const need = dir === "ej" && S.mode === "kanji" ? requiredKanji(w) : [], nb = $("#fbNeed");
    nb.hidden = !need.length || need.length === [...new Set([...w.kanji].filter((c) => KANJI.test(c)))].length;
    nb.innerHTML = nb.hidden ? "" : `Must be kanji here: <b>${esc(need.join("、"))}</b>. The rest can be kana.`;
    //#if public
    $("#fbRead").textContent = readAs(r) && "The checker read: " + readAs(r);
    //#else
    $("#fbRead").textContent = readAs(r) && "Claude read: " + readAs(r);
    //#endif
    $("#feedback").hidden = false; $("#overrideBtn").hidden = false; setErasing(false);
    requestAnimationFrame(() => { scratch.resize(); $("#feedback").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); });
  }
  $("#nextBtn").onclick = nextItem;
  $("#overrideBtn").onclick = () => {
    Q.wrong = Q.wrong.filter((it) => it !== Q.cur);
    Q.done.add(Q.cur.key);
    saveResume();
    nextItem();
  };

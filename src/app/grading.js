  function showErr(m) { const el = $("#checkErr"); el.textContent = m; el.hidden = false; }
  $("#checkBtn").onclick = check;

  function grade(ok, r) {
    const { key, w, dir } = Q.cur;
    Q.tries[key] = (Q.tries[key] || 0) + 1;
    Q.answered = true; syncCheck();
    main.c.classList.add("locked"); furi.c.classList.add("locked");
    // Force kanji hides the reading of 日本語 → English questions until the answer is checked.
    if (dir === "je") $("#qSub").textContent = KANJI.test($("#qText").textContent) ? w.kana : "";
    // A right answer goes straight on to the next word (the 花丸 that used to be drawn first was taken out, the owner 2026-10-23).
    if (ok) { Q.done.add(key); saveResume(); nextItem(); return; }
    Q.wrong.push(Q.cur); saveResume();
    $("#tools").hidden = true;
    $("#fbReason").textContent = r?.reason || "";
    const a = $("#fbAnswer");
    if (dir === "ej") { a.className = "answer"; a.innerHTML = w.kanji ? `<ruby>${esc(w.kanji)}<rt>${esc(w.kana)}</rt></ruby>` : esc(w.kana); }
    else { a.className = "answer en"; a.textContent = w.en; }
    const need = dir === "ej" && S.mode === "kanji" ? requiredKanji(w) : [], nb = $("#fbNeed");
    nb.hidden = !need.length || need.length === [...new Set([...w.kanji].filter((c) => KANJI.test(c)))].length;
    nb.innerHTML = nb.hidden ? "" : `Must be kanji here: <b>${esc(need.join("、"))}</b>. The rest can be kana.`;
    const read = [r?.furigana ? `furigana 「${r.furigana}」` : "", r?.main ? `「${r.main}」` : ""].filter(Boolean);
    //#if public
    $("#fbRead").innerHTML = read.length ? "Read as: " + read.map(esc).join(" over ") : "";
    //#else
    $("#fbRead").innerHTML = read.length ? "Claude read: " + read.map(esc).join(" over ") : "";
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

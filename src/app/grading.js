  function showErr(m) { const el = $("#checkErr"); el.textContent = m; el.hidden = false; }
  $("#checkBtn").onclick = check;

  function grade(ok, r) {
    const { key, w, dir } = Q.cur;
    Q.tries[key] = (Q.tries[key] || 0) + 1;
    Q.answered = true; syncCheck();
    main.c.classList.add("locked"); furi.c.classList.add("locked");
    // Force kanji hides the reading of 日本語 → English questions until the answer is checked.
    if (dir === "je") $("#qSub").textContent = KANJI.test($("#qText").textContent) ? w.kana : "";
    if (ok) { Q.done.add(key); saveResume(); hanamaru().then(nextItem); return; }
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

  // 花丸: a spiral with a ring of petals, drawn in red pen.
  (function buildMaru() {
    let d = "", turns = 2.6, steps = 120;
    for (let i = 0; i <= steps; i++) { const t = i / steps, a = t * turns * Math.PI * 2 - Math.PI / 2, r = 6 + t * 26; d += (i ? "L" : "M") + (r * Math.cos(a)).toFixed(1) + " " + (r * Math.sin(a)).toFixed(1); }
    const petals = 7;
    for (let i = 0; i <= petals * 24; i++) { const a = (i / (petals * 24)) * Math.PI * 2 - Math.PI / 2, r = 40 + 9 * Math.abs(Math.sin((a + Math.PI / 2) * petals / 2)); d += "L" + (r * Math.cos(a)).toFixed(1) + " " + (r * Math.sin(a)).toFixed(1); }
    $("#maruPath").setAttribute("d", d);
  })();
  function hanamaru() {
    const svg = $("#maru"), p = $("#maruPath");
    svg.hidden = false;
    const len = p.getTotalLength(), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    p.style.strokeDasharray = len; p.style.strokeDashoffset = reduce ? 0 : len;
    if (!reduce) p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 750, easing: "ease-out", fill: "forwards" });
    return new Promise((res) => setTimeout(res, reduce ? 600 : 1050));
  }

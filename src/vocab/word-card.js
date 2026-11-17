  // ---------- a card of words ----------
  // Holding down (or right-clicking) a set, a unit or a collection shows its words on a small card that can't be edited,
  // as wide as its words need: something to look over on a phone, or to screenshot. parts: [{ name, words }], one per set;
  // with more than one, each set's name heads its words.
  function wordCard(title, parts) {
    parts = parts.map((p) => ({ name: p.name, words: p.words.filter(wordReady) })).filter((p) => p.words.length);
    const words = parts.flatMap((p) => p.words), kanji = words.some((w) => w.kanji);
    const cell = (t) => `<td${KANJI.test(t) || /[ぁ-ヿ]/.test(t) ? ' class="jp"' : ""}>${esc(t)}</td>`;
    const row = (w) => `<tr>${cell(w.en)}${cell(w.kana || "")}${kanji ? cell(w.kanji || "") : ""}</tr>`;
    $("#wordCardTitle").textContent = title;
    $("#wordCardN").textContent = plural(words.length, "word");
    $("#wordCardBody").innerHTML = !words.length ? `<p class="muted">No words yet.</p>`
      : `<table class="wcard"><thead><tr><th>English</th><th>Kana</th>${kanji ? "<th>Kanji</th>" : ""}</tr></thead>${parts.map((p) =>
        `<tbody>${parts.length > 1 ? `<tr class="wset"><th colspan="${kanji ? 3 : 2}">${esc(p.name)}</th></tr>` : ""}${p.words.map(row).join("")}</tbody>`).join("")}</table>`;
    const d = $("#wordCard");
    if (!d.open) d.showModal();
    $("#wordCardBody").scrollTop = 0;
  }
  $("#wordCardX").onclick = () => $("#wordCard").close();
  // A tap outside the card closes it.
  $("#wordCard").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  // The words of sets, as wordCard's parts: each named by its unit and name, or by its name alone (byName).
  const cardParts = (sets, byName) => sets.map((s) => ({ name: byName ? s.name : `${s.unit} › ${s.name}`, words: s.words }));
  const setsOfKeys = (keys) => keys.flatMap((k) => S.sets.filter((s) => unitKey(s) === k));

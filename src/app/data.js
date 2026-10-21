  // ---------- data ----------
  // Vocab is grouped Collection › Unit › Set: a collection (a textbook, a course, any list of lists) has units (Ch. 3,
  // Week 1, any name), and each unit has sets; kanji lists go by unit. Documents saved before October 2026 name a book,
  // a numbered chapter and a section with an optional label: they're read as collection, unit "Ch. N" and set name "A · Label".
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const tidy = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const oldUnit = (v) => { const c = tidy(v, 60).replace(/^ch(apter)?\.?\s*(?=\d)/i, ""); return /^\d+$/.test(c) ? `Ch. ${+c}` : c; };
  const docCol = (d) => tidy(d.collection ?? d.book, 100);
  const docUnit = (d) => (d.unit != null ? tidy(d.unit, 60) : oldUnit(d.chapter)) || "No unit";
  const docName = (d) => tidy(d.name ?? [d.section, d.label].map((x) => tidy(x, 200)).filter(Boolean).join(" · "), 200) || "Untitled set";
  // Units sort by name with numbers in order (Week 2 before Week 10). In a unit, Kanji sets, Extras and supplementary lists come last.
  const byUnit = (a, b) => coll.compare(String(a), String(b));
  const secRank = (s) => { s = String(s || ""); return /^kanji/i.test(s) ? 1 : /^extra/i.test(s) ? 2 : /^supp/i.test(s) ? 3 : 0; };
  const sortSets = (a, b) => byCol(colOf(a), colOf(b)) || byUnit(a.unit, b.unit) || secRank(a.name) - secRank(b.name) || coll.compare(a.name, b.name);
  const sortLists = (a, b) => byCol(colOf(a), colOf(b)) || byUnit(a.unit, b.unit);
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const slug = (t, d) => t.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 80) || d;
  const freeId = (base, taken) => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; return id; };
  const colOf = (x) => x.collection || "";
  // Collections follow the saved order (meta/books: the order they're studied in); any not in it come after, by name.
  const colRank = (b) => { const i = S.colOrder.indexOf(b); return i < 0 ? S.colOrder.length : i; };
  const byCol = (a, b) => colRank(a) - colRank(b) || coll.compare(String(a), String(b));
  const cols = () => [...new Set([...S.sets, ...S.kanjiLists].map(colOf))].sort(byCol);
  const multiCol = () => cols().length > 1;
  const colLabel = (b) => b || "No collection";
  // The collection in view: the one picked, or the first one while the picked one doesn't exist (yet).
  const shownCol = (b) => { const bs = cols(); return bs.includes(b) ? b : bs[0] ?? ""; };
  // Typed names match an existing collection, or unit of that collection, whatever their case ("ch. 3" is "Ch. 3").
  const canonCol = (v) => { const t = tidy(v, 100); return cols().find((b) => sameName(b, t)) ?? t; };
  const canonUnit = (col, v) => { const t = tidy(v, 60); return [...S.sets, ...S.kanjiLists].find((x) => colOf(x) === col && sameName(x.unit, t))?.unit ?? t; };
  const unitKey = (x) => `${colOf(x)}\u0001${x.unit}`;
  const keyUnit = (k) => k.split("\u0001")[1];
  // Picks saved before units name the chapter number ("Nakama 1\u00013"), now "Nakama 1\u0001Ch. 3" (unless a unit is named "3").
  const newKey = (k, has) => (/\u0001\d+$/.test(k) && !has(k) ? k.replace(/\u0001(\d+)$/, "\u0001Ch. $1") : k);
  // "Nakama 1 › Ch. 3" when there's more than one collection, else "Ch. 3".
  const unitTitle = (x) => `${multiCol() ? colLabel(colOf(x)) + " › " : ""}${x.unit}`;
  const setName = (s) => `${unitTitle(s)} › ${s.name}`;
  const jpForm = (w) => w.kanji || w.kana;

  // A course takes a range of units from one collection, by name: { collection, from, to }. Older courses gave a book and chapter numbers.
  const coursePart = (p) => (p?.collection != null ? { collection: tidy(p.collection, 100), from: tidy(p.from, 60), to: tidy(p.to, 60) }
    : { collection: tidy(p?.book, 100), from: oldUnit(p?.from), to: oldUnit(p?.to) });
  function onCourses(snap) {
    raw.courses = snap.exists ? snap.data() : null;
    const list = snap.exists ? snap.data()?.courses : null;
    S.courses = (Array.isArray(list) ? list : []).filter((c) => c && c.name && Array.isArray(c.parts))
      .map((c) => ({ name: String(c.name), parts: c.parts.map(coursePart) }));
    renderSetup(); renderTable();
  }
  function onBookOrder(snap) {
    raw.books = snap.exists ? snap.data() : null;
    const o = snap.exists ? snap.data()?.order : null;
    S.colOrder = Array.isArray(o) ? o.map(String) : [];
    S.sets.sort(sortSets);
    S.kanjiLists.sort(sortLists);
    if (S.kLoaded) renderUpto(); // before the kanji lists load, renderUpto would reset the choice
    renderSetup(); renderTable();
  }
  function onSets(snap) {
    raw.sets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    S.sets = snap.docs.map((d) => { const x = d.data(); return { id: d.id, collection: docCol(x), unit: docUnit(x), name: docName(x), tags: x.tags, words: (x.words || []).map((w) => ({ ...w })) }; }).sort(sortSets);
    S.loaded = true;
    const ids = new Set(S.sets.map((s) => s.id));
    for (const id of [...S.selected]) if (!ids.has(id)) S.selected.delete(id);
    renderSetup();
    renderTable();
  }

  // ---------- setup ----------
  // A word can be asked once it has English and a Japanese form; blank rows don't count.
  const wordReady = (w) => !!((w.en || "").trim() && (w.kana || w.kanji));
  const readyCount = (words) => words.filter(wordReady).length;
  function selectedWords() {
    const out = [];
    for (const s of S.sets) if (S.selected.has(s.id)) for (const w of s.words) {
      const x = wordReady(w) && (S.mode === "kata" ? kataWord(w) : S.mode === "verb" ? verbOf(w) && w : w);
      if (x) out.push({ ...x, set: setName(s) });
    }
    return out;
  }
  // Katakana only keeps the words written (partly) in katakana, and of their ／ alternatives only the katakana ones:
  // たばこ／タバコ (煙草／タバコ) is asked as タバコ, やかん／ケトル as ケトル. null when the word has no katakana.
  const KATA = /[ァ-ヺ]/;
  function kataWord(w) {
    const ka = String(w.kana || "").split(/[／/]/), kj = String(w.kanji || "").split(/[／/]/).filter(Boolean);
    const keep = ka.map((a, i) => (KATA.test(a) ? i : -1)).filter((i) => i >= 0);
    if (!keep.length) return null;
    if (keep.length === ka.length) return w;
    const kanji = kj.length === ka.length ? keep.map((i) => kj[i]).join("／") : w.kanji || "";
    return { ...w, kana: keep.map((i) => ka[i]).join("／"), kanji: KANJI.test(kanji) ? kanji : "" };
  }

  // ---------- vocab documents ----------
  // What's stored, and how each document is read. Nothing here looks at the page, so the AI page's import uses it too.
  //   sets/<id>      { collection, unit, name, tags?, words: [{ id, en, kana, kanji }] }
  //   kanji/<id>     { collection, unit, kanji }       the kanji a unit teaches, as one string
  //   meta/books     { order: [collection, …] }        the order the collections are studied in
  //   meta/courses   { courses: [{ name, parts: [{ collection, from, to }] }] }
  // Vocab is grouped Collection › Unit › Set: a collection (a textbook, a course, any list of lists) has units (Ch. 3,
  // Week 1, any name), and each unit has sets; kanji lists go by unit. Documents saved before October 2026 name a book,
  // a numbered chapter and a section with an optional label: they're read as collection, unit "Ch. N" and set name "A · Label".
  const tidy = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const oldUnit = (v) => { const c = tidy(v, 60).replace(/^ch(apter)?\.?\s*(?=\d)/i, ""); return /^\d+$/.test(c) ? `Ch. ${+c}` : c; };
  const docCol = (d) => tidy(d.collection ?? d.book, 100);
  const docUnit = (d) => (d.unit != null ? tidy(d.unit, 60) : oldUnit(d.chapter)) || "No unit";
  const docName = (d) => tidy(d.name ?? [d.section, d.label].map((x) => tidy(x, 200)).filter(Boolean).join(" · "), 200) || "Untitled set";
  const colLabel = (b) => b || "No collection";
  // "Genki 1 › Lesson 3" and "Genki 1 › Lesson 3 › Food": the collection is named only where there's more than one (withCol).
  const unitPath = (x, withCol) => `${withCol ? colLabel(x.collection || "") + " › " : ""}${x.unit}`;
  const setPath = (s, withCol) => `${unitPath(s, withCol)} › ${s.name}`;
  // A set's own tags: up to 12 short labels, matched without case; a comma (or 、) separates them when typed.
  const tagKey = (t) => t.toLowerCase();
  function cleanTags(v) {
    const out = [], seen = new Set();
    for (const t of Array.isArray(v) ? v : String(v ?? "").split(/[,、，]/)) {
      const x = tidy(t, 30);
      if (x && !seen.has(tagKey(x)) && out.length < 12) { seen.add(tagKey(x)); out.push(x); }
    }
    return out;
  }
  // A course takes a range of units from one collection, by name: { collection, from, to }. Older courses gave a book and chapter numbers.
  const coursePart = (p) => (p?.collection != null ? { collection: tidy(p.collection, 100), from: tidy(p.from, 60), to: tidy(p.to, 60) }
    : { collection: tidy(p?.book, 100), from: oldUnit(p?.from), to: oldUnit(p?.to) });

  // The documents exactly as stored, with their ids: what Export writes out and Import compares a file with.
  const withIds = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const dataOrNull = (snap) => (snap.exists ? snap.data() : null);
  // All four at once, for a page that doesn't keep them loaded (the AI page; the site itself listens to each, see boot).
  async function readVocab(db) {
    const [sets, kanji, books, courses] = await Promise.all([db.collection("sets").get(), db.collection("kanji").get(), db.doc("meta/books").get(), db.doc("meta/courses").get()]);
    return { sets: withIds(sets), kanji: withIds(kanji), books: dataOrNull(books), courses: dataOrNull(courses) };
  }
  // A vocab file (Export writes one, Import reads one, an AI can make one: see ai/) is those documents in one JSON object:
  // { app: APP, version: 2, sets: [...], kanji: [...], collections: { order }, courses }.
  const APP = "jp-vocab-practice";
  // Each cleaner returns the document to store, in the current format, or null when what it's given isn't usable.
  // Files and older documents go through them, so their contents are never trusted.
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
  const rid = () => Math.random().toString(36).slice(2, 9);
  const str = (v, n = 500) => String(v ?? "").slice(0, n);
  const cleanSet = (d) => !d || typeof d !== "object" || !ID_RE.test(String(d.id ?? "")) || !Array.isArray(d.words) ? null : {
    collection: docCol(d), unit: docUnit(d), name: docName(d), ...(cleanTags(d.tags).length ? { tags: cleanTags(d.tags) } : {}),
    words: d.words.slice(0, 3000).filter((w) => w && typeof w === "object").map((w) => ({ id: ID_RE.test(String(w.id ?? "")) ? String(w.id) : rid(), en: str(w.en), kana: str(w.kana), kanji: str(w.kanji) })) };
  const cleanKanji = (d) => !d || typeof d !== "object" || !ID_RE.test(String(d.id ?? "")) ? null : { collection: docCol(d), unit: docUnit(d), kanji: str(d.kanji, 20000) };
  const cleanBooks = (d) => Array.isArray(d?.order) ? { order: d.order.slice(0, 50).map((b) => str(b, 100)) } : null;
  // Courses come as stored ({ courses: [...] }) or, in a hand-made file, as the bare list.
  function cleanCourses(d) {
    const list = Array.isArray(d) ? d : d?.courses;
    return Array.isArray(list) ? { courses: list.slice(0, 50).filter((c) => c && c.name && Array.isArray(c.parts)).map((c) => ({ name: str(c.name, 100),
      parts: c.parts.slice(0, 20).filter((x) => x && typeof x === "object").map(coursePart).filter((x) => x.from && x.to) })) } : null;
  }

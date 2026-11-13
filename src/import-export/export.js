  // ---------- exporting the vocab as a file ----------
  // Every set and kanji list, the collection order and the views (or, before views were saved, the courses), in the
  // current format whatever format each was saved in.
  async function exportVocab() {
    const setById = new Map(raw.sets.map((d) => [d.id, d])), kById = new Map(raw.kanji.map((d) => [d.id, d]));
    const tidied = (list, byId, clean) => list.map((x) => byId.get(x.id)).filter(Boolean).map((d) => ({ id: d.id, ...clean(d) }));
    const file = { app: APP, version: 2, exportedAt: new Date().toISOString(),
      sets: tidied(S.sets, setById, cleanSet), kanji: tidied(S.kanjiLists, kById, cleanKanji),
      collections: cleanBooks(raw.books), ...(S.viewDoc ? { views: S.viewDoc } : { courses: cleanCourses(raw.courses) }) };
    //#if public
    const name = `japanese-vocab-${new Date().toLocaleDateString("en-CA")}.json`;
    //#else
    const name = `jp-vocab-${new Date().toLocaleDateString("en-CA")}.json`;
    //#endif
    portMsg("");
    try { await downloads.save({ filename: name, data: JSON.stringify(file, null, 1) }); portMsg(`Saved ${name}.`); }
    catch (e) { portMsg(e?.code === "declined" ? "" : e?.code === "rate_limited" ? "A save prompt is already open." : "The file couldn't be saved in this view."); }
  }

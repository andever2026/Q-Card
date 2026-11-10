  // ---------- public site: sample sets ----------
  // A new visitor starts with the sets in data/samples.json (written for this site, not from a textbook), so there's
  // something to practice before learning the vocab table. They're ordinary sets in their own collection. meta/samples
  // records that they were offered, so they never come back on their own once removed.
  const SAMPLE_COL = "Sample sets", isSample = (x) => colOf(x) === SAMPLE_COL;
  const sampleFile = () => dataFile("samples");
  // All at once: over a slow connection, one write after another kept a new account empty for several seconds.
  async function addSamples(file) {
    file = await (file || sampleFile());
    const now = new Date().toISOString();
    await Promise.all([...file.sets.map((d) => db.doc("sets/" + d.id).set({ ...cleanSet(d), updatedAt: now })),
      ...file.kanji.map((d) => db.doc("kanji/" + d.id).set({ ...cleanKanji(d), updatedAt: now }))]);
  }
  // For a new account (or guest): nothing but sample sets in it, if any. meta/samples is written once they're all in, so an
  // offer cut short (the page closed midway) is finished next time. While it's being decided, the picker says so (see
  // renderSetup) instead of "No vocab sets yet".
  let samplesState = ""; // "checking", "adding" or ""
  async function offerSamples() {
    samplesState = "checking";
    const file = sampleFile(); file.catch(() => {});
    try {
      if ((await db.doc("meta/samples").get()).exists) return;
      const [sets, kanji] = await Promise.all([db.collection("sets").get(), db.collection("kanji").get()]);
      const own = (snap) => snap.docs.some((d) => !d.id.startsWith("samples-"));
      if (!own(sets) && !own(kanji)) { samplesState = "adding"; renderSetup(); await addSamples(file); }
      await db.doc("meta/samples").set({ offeredAt: new Date().toISOString() });
    } catch {
      if (samplesState === "adding") banner("The sample sets couldn't be added. Reload the page to try again.");
    } finally { samplesState = ""; renderSetup(); }
  }
  let sampleAsk = false;
  function renderSampleNote() {
    const el = $("#sampleNote"), n = S.sets.filter(isSample).length;
    el.hidden = !n;
    if (!n) { sampleAsk = false; return; }
    el.innerHTML = sampleAsk
      ? `Remove the ${n} sample ${n === 1 ? "set" : "sets"} and their kanji lists? <button class="link" type="button" id="sampleYes">Remove</button> · <button class="link" type="button" id="sampleNo">Keep them</button>`
      : `The sample sets are here so you can try the page right away. Add your own in the vocab table, or import a file from Settings, whenever you're ready. <button class="link" type="button" id="sampleRemove">Remove the sample sets</button>`;
    if (!sampleAsk) { $("#sampleRemove").onclick = () => { sampleAsk = true; renderSampleNote(); }; return; }
    $("#sampleNo").onclick = () => { sampleAsk = false; renderSampleNote(); };
    $("#sampleYes").onclick = async () => {
      sampleAsk = false;
      const ids = S.sets.filter(isSample).map((x) => x.id);
      ids.forEach((id) => S.selected.delete(id)); saveSetup();
      try { for (const id of ids) await db.doc("sets/" + id).delete(); for (const k of S.kanjiLists.filter(isSample)) await db.doc("kanji/" + k.id).delete(); }
      catch { banner("Some sample sets couldn't be removed. Try again."); }
      renderSampleNote();
    };
  }

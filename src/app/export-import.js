  // ---------- export / import (owner and editors) ----------
  const APP = "jp-vocab-practice";
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
  const str = (v, n = 500) => String(v ?? "").slice(0, n);
  // Each cleaner returns the document to store, or null when the file's entry isn't usable. File contents are untrusted.
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
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const portMsg = (m) => { $("#portMsg").hidden = !m; $("#portMsg").textContent = m || ""; };

  function renderPort() {
    $("#portPanel").hidden = !canWrite || !db;
    if ($("#portPanel").hidden) return;
    $("#exportBtn").disabled = !downloads || !S.loaded || importing;
    $("#exportBtn").title = downloads ? "" : "Saving files isn't available in this view.";
    $("#importBtn").disabled = importing;
  }

  async function exportVocab() {
    const setById = new Map(raw.sets.map((d) => [d.id, d])), kById = new Map(raw.kanji.map((d) => [d.id, d]));
    // Written in the current format (collection, unit, name), whatever format each document was saved in.
    const tidied = (list, byId, clean) => list.map((x) => byId.get(x.id)).filter(Boolean).map((d) => ({ id: d.id, ...clean(d) }));
    const file = { app: APP, version: 2, exportedAt: new Date().toISOString(),
      sets: tidied(S.sets, setById, cleanSet), kanji: tidied(S.kanjiLists, kById, cleanKanji),
      collections: cleanBooks(raw.books), courses: cleanCourses(raw.courses) };
    //#if public
    const name = `japanese-vocab-${new Date().toLocaleDateString("en-CA")}.json`;
    //#else
    const name = `jp-vocab-${new Date().toLocaleDateString("en-CA")}.json`;
    //#endif
    portMsg("");
    try { await downloads.save({ filename: name, data: JSON.stringify(file, null, 1) }); portMsg(`Saved ${name}.`); }
    catch (e) { portMsg(e?.code === "declined" ? "" : e?.code === "rate_limited" ? "A save prompt is already open." : "The file couldn't be saved in this view."); }
  }

  // Compares the file with what's here and lists what an import would add or change; nothing is written yet.
  function planImport(file, name) {
    if (!file || typeof file !== "object" || file.app !== APP || !Array.isArray(file.sets)) throw "This file isn't a Japanese Vocab Practice export.";
    let skipped = 0;
    const walk = (list, here, clean, title) => {
      const have = new Map(here.map((d) => [d.id, clean(d)])), seen = new Map();
      for (const d of Array.isArray(list) ? list : []) { const c = clean(d); if (c) seen.set(String(d.id), c); else skipped++; }
      return [...seen].map(([id, doc]) => ({ id, doc, title: title(doc), status: !have.has(id) ? "new" : same(have.get(id), doc) ? "same" : "changed" }));
    };
    const sets = walk(file.sets, raw.sets, cleanSet, setName), kanji = walk(file.kanji, raw.kanji, cleanKanji, unitTitle);
    const meta = (v, here, clean) => { const c = v == null ? null : clean(v); if (v != null && !c) skipped++; return c && { doc: c, changed: !same(clean(here), c) }; };
    return { name, exportedAt: file.exportedAt, sets, kanji, books: meta(file.collections ?? file.books, raw.books, cleanBooks), courses: meta(file.courses, raw.courses, cleanCourses), skipped };
  }

  function renderImport() {
    const box = $("#importPreview"), p = importPlan;
    box.hidden = !p;
    if (!p) { box.innerHTML = ""; return; }
    const count = (xs, st) => xs.filter((x) => x.status === st).length;
    const line = (xs, noun) => {
      if (!xs.length) return `${noun}: none in the file`;
      const n = count(xs, "new"), c = count(xs, "changed"), k = count(xs, "same");
      if (!n && !c) return `${noun}: all ${xs.length} already the same`;
      return `${noun}: ${[n && `${n} new`, c && `${c} changed`, k && `${k} already the same`].filter(Boolean).join(", ")}`;
    };
    const metaLine = (m, noun) => `${noun}: ${!m ? "not in the file" : m.changed ? "will change" : "already the same"}`;
    const names = (st) => { const xs = [...p.sets, ...p.kanji.map((k) => ({ ...k, title: "Kanji " + k.title }))].filter((x) => x.status === st).map((x) => x.title);
      return xs.length ? `<div class="names"><b>${st === "new" ? "New" : "Changed"}:</b> ${esc(xs.slice(0, 12).join(", "))}${xs.length > 12 ? `, and ${xs.length - 12} more` : ""}</div>` : ""; };
    const todo = p.sets.filter((x) => x.status !== "same").length + p.kanji.filter((x) => x.status !== "same").length + (p.books?.changed ? 1 : 0) + (p.courses?.changed ? 1 : 0);
    const when = p.exportedAt && !isNaN(new Date(p.exportedAt)) ? ` · exported ${new Date(p.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "";
    box.innerHTML = `<div><b>${esc(p.name)}</b><span class="muted small">${esc(when)}</span></div>
      <ul class="small"><li>${line(p.sets, "Vocab sets")}</li><li>${line(p.kanji, "Kanji lists")}</li><li>${metaLine(p.books, "Collection order")}</li><li>${metaLine(p.courses, "Courses")}</li>
      ${p.skipped ? `<li>${p.skipped} ${p.skipped === 1 ? "entry isn't" : "entries aren't"} valid and will be skipped</li>` : ""}</ul>
      ${names("new")}${names("changed")}
      <div class="tactions">${todo ? `<button class="btn primary" type="button" id="importGo">Import ${todo} ${todo === 1 ? "change" : "changes"}</button><button class="link" type="button" id="importCancel">Cancel</button>`
        : `<span class="muted small">Everything in this file is already here.</span><button class="link" type="button" id="importCancel">Close</button>`}</div>`;
    $("#importCancel").onclick = () => { importPlan = null; renderImport(); };
    if (todo) $("#importGo").onclick = runImport;
  }

  // Writes only what's new or changed, one document at a time; sets that aren't in the file are left alone.
  async function runImport() {
    const p = importPlan, now = new Date().toISOString();
    const jobs = [...p.sets.filter((x) => x.status !== "same").map((x) => ["sets/" + x.id, { ...x.doc, updatedAt: now }]),
      ...p.kanji.filter((x) => x.status !== "same").map((x) => ["kanji/" + x.id, { ...x.doc, updatedAt: now }]),
      ...(p.books?.changed ? [["meta/books", { ...p.books.doc, updatedAt: now }]] : []), ...(p.courses?.changed ? [["meta/courses", p.courses.doc]] : [])];
    importing = true; importPlan = null; renderImport(); renderPort();
    let done = 0;
    try {
      for (const [path, doc] of jobs) { portMsg(`Importing ${done + 1} of ${jobs.length}…`); await db.doc(path).set(doc); done++; }
      const n = (pre, st) => p[pre].filter((x) => x.status === st).length, pl = (k, w) => k && `${k} ${w}${k === 1 ? "" : "s"}`;
      portMsg(`Imported: ${[pl(n("sets", "new"), "new set"), pl(n("sets", "changed"), "updated set"), pl(n("kanji", "new") + n("kanji", "changed"), "kanji list"),
        p.books?.changed && "collection order", p.courses?.changed && "courses"].filter(Boolean).join(", ")}.`);
    } catch (e) {
      portMsg(`Stopped after ${done} of ${jobs.length}: ${e?.message || "the database refused the change"}. What was imported stays; import the file again to finish.`);
    }
    importing = false; renderPort();
  }

  $("#exportBtn").onclick = exportVocab;
  $("#importBtn").onclick = () => { $("#importFile").value = ""; $("#importFile").click(); };
  $("#importFile").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    portMsg("");
    try { importPlan = planImport(JSON.parse(await f.text()), f.name); }
    catch (err) { importPlan = null; portMsg(typeof err === "string" ? err : "That file couldn't be read. Pick a .json file made by Export."); }
    renderImport();
  };

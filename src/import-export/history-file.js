  // ---------- Settings → Practice history: the history as a file ----------
  // Export saves every session. Import adds the file's sessions that aren't here yet (matched by id), so a file from
  // another browser or account merges into this history; sessions already here are left as they are, none is deleted.
  const histPortMsg = sayIn($("#histPortMsg"));
  let histPlan = null, histBusy = false;
  // A session as saved by results.js, keeping only what the page reads; null if it isn't one.
  const cleanSession = (d) => {
    if (!d || typeof d !== "object" || !/^t\d+$/.test(String(d.id)) || isNaN(new Date(d.finishedAt)) || !Array.isArray(d.words)) return null;
    const str = (v) => (v == null ? "" : String(v));
    return { finishedAt: new Date(d.finishedAt).toISOString(), dir: str(d.dir), mode: str(d.mode), sets: (Array.isArray(d.sets) ? d.sets : []).map(str),
      words: d.words.filter((w) => w && typeof w === "object").map((w) => ({ id: str(w.id), en: str(w.en), jp: str(w.jp), dir: str(w.dir),
        tries: Math.max(1, Math.round(+w.tries) || 1), ...(w.skip === true ? { skip: true } : {}) })) };
  };
  function renderHistPort() {
    const off = S.histOn !== true;
    $("#histPort").hidden = S.histBlocked || !S.histReady || !db;
    $("#histExport").disabled = !downloads || !S.history.length || histBusy;
    $("#histExport").title = !downloads ? "Saving files isn't available in this view." : S.history.length ? "" : "No practice sessions to export yet.";
    $("#histImport").disabled = off || histBusy;
    $("#histImport").title = off ? "Turn on practice history first." : "";
    const p = histPlan, box = $("#histImportPreview");
    box.hidden = !p;
    if (!p) { box.innerHTML = ""; return; }
    const pl = (k, w = "session") => `${k} ${w}${k === 1 ? "" : "s"}`;
    const span = p.add.length ? `<li>From ${esc(fmtDay(p.add[p.add.length - 1].finishedAt))} to ${esc(fmtDay(p.add[0].finishedAt))}</li>` : "";
    box.innerHTML = `${previewHead(p)}
      <ul class="small"><li>${p.add.length ? `${pl(p.add.length, "new session")} to add` : "No new sessions"}</li>${span}${p.have ? `<li>${pl(p.have)} already here, left as they are</li>` : ""}
      ${skippedLine(p.skipped)}</ul>
      <div class="tactions">${p.add.length ? `<button class="btn primary" type="button" id="histImportGo">Add ${pl(p.add.length)}</button><button class="link" type="button" id="histImportCancel">Cancel</button>`
        : `<span class="muted small">Every session in this file is already here.</span><button class="link" type="button" id="histImportCancel">Close</button>`}</div>`;
    box.querySelector("#histImportCancel").onclick = () => { histPlan = null; renderHistPort(); };
    if (p.add.length) box.querySelector("#histImportGo").onclick = importHistory;
  }
  $("#histExport").onclick = () => saveJsonFile("history", { app: APP, kind: "history", version: 1, exportedAt: new Date().toISOString(),
    sessions: S.history.map((t) => ({ id: t.id, ...cleanSession(t) })) }, histPortMsg);
  $("#histImport").onclick = () => { $("#histFile").value = ""; $("#histFile").click(); };
  $("#histFile").onchange = async () => {
    const f = $("#histFile").files?.[0];
    if (!f) return;
    histPortMsg(""); histPlan = null;
    let file = null;
    try { file = JSON.parse(await f.text()); } catch {}
    if (file?.app === APP && Array.isArray(file.sets)) { renderHistPort(); return histPortMsg("This is a vocab file. Import it in Settings → Data."); }
    if (file?.app !== APP || file.kind !== "history" || !Array.isArray(file.sessions)) { renderHistPort(); return histPortMsg("This isn't a practice history file. Pick a .json file saved with Export history."); }
    const here = new Set(S.history.map((t) => t.id)), add = new Map();
    let skipped = 0, have = 0;
    for (const d of file.sessions) { const c = cleanSession(d); if (!c) skipped++; else if (here.has(String(d.id))) have++; else add.set(String(d.id), { id: String(d.id), ...c }); }
    histPlan = { name: f.name, exportedAt: file.exportedAt, add: [...add.values()].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)), have, skipped };
    renderHistPort();
  };
  async function importHistory() {
    const add = histPlan.add;
    histPlan = null; histBusy = true; renderHistPort();
    let n = 0;
    if (S.local) { saveLocal([...add, ...S.history].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))); n = add.length; }
    else for (const { id, ...doc } of add) {
      histPortMsg(`Adding ${n + 1} of ${add.length}…`);
      try { await db.collection("data/users/" + uid).doc(id).set(doc); n++; } catch { break; }
    }
    histPortMsg(n === add.length ? `Added ${n} session${n === 1 ? "" : "s"} to your history.` : `Stopped after ${n} of ${add.length}. Import the file again to add the rest.`);
    histBusy = false; renderHistPort();
  }

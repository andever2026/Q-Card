  // ---------- Settings → Export / import (owner and editors) ----------
  const portMsg = sayIn($("#portMsg"));
  // Import here compares the file with the documents the page has loaded, and writes where the page saves everything else.
  const importer = makeImporter({ button: $("#importBtn"), input: $("#importFile"), box: $("#importPreview"), say: portMsg,
    stored: () => raw, write: (path, doc) => db.doc(path).set(doc), changed: () => renderPort() });
  function renderPort() {
    $("#portPanel").hidden = !canWrite || !db;
    if ($("#portPanel").hidden) return;
    $("#exportBtn").disabled = !downloads || !S.loaded || importer.busy;
    $("#exportBtn").title = downloads ? "" : "Saving files isn't available in this view.";
  }
  $("#exportBtn").onclick = exportVocab;

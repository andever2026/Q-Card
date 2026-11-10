// The AI page (ai/): its Copy button, and its Import, which shows the same preview as Settings → Import right on this page
// and saves where the site keeps this person's vocab. Loaded after the page (defer); without it the page still reads fine.
(() => {
  //#include page/dom.js
  //#include vocab/docs.js
  //#include import-export/import.js

  // The message names this page as it's served (so the beta page names itself); opened from disk, the live link stays.
  if (/^https?:$/.test(location.protocol)) $("#pageLink").textContent = location.origin + location.pathname;
  $("#copyBtn").onclick = async () => {
    const b = $("#copyBtn");
    try { await navigator.clipboard.writeText($("#askText").textContent); b.textContent = "Copied"; }
    catch { getSelection().selectAllChildren($("#askText")); b.textContent = "Selected"; } // no clipboard here: they copy it themselves
    clearTimeout(b.reset); b.reset = setTimeout(() => (b.textContent = "Copy"), 2500);
  };

  // Where this person's vocab is kept is the site's own answer (js/platform.js: their account when signed in, else this
  // browser). That file is the sign-in and the database, so it's fetched only once a file is being imported.
  let home = null, ready = null; // home: { who, db }, kept up to date if they sign in or out in another tab
  const open = () => (ready ||= new Promise((ok, no) => {
    const s = Object.assign(document.createElement("script"), { src: "../js/platform.js" });
    s.onerror = no;
    s.onload = () => { const p = window.qcardPlatform; if (!p) return no(); p.onAuth((who) => { home = { who, db: p.storeFor(who).db }; ok(); }); };
    document.head.append(s);
  }).catch((e) => { ready = null; throw e; }));
  let into = null; // where the preview on screen will be saved: the import goes there even if `home` changes meanwhile
  makeImporter({ button: $("#aiImportBtn"), input: $("#aiImportFile"), box: $("#aiImportPreview"), say: sayIn($("#aiImportMsg")),
    hint: "Ask your AI to make it the way this page says.",
    stored: async () => { $("#aiImportDone").hidden = true; await open(); into = home; return readVocab(into.db); },
    write: (path, doc) => into.db.doc(path).set(doc),
    where: () => (into.who ? `This saves to your account${into.who.email ? ` (${into.who.email})` : ""}.`
      : "You're not signed in, so this saves in this browser only. To save to an account, sign in on the site first, then import here."),
    done: () => { $("#aiImportDone").hidden = false; },
  });
})();

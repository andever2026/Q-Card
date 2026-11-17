  // ---------- each part of the page has its own address (public site) ----------
  // The page loads once and swaps what it shows, so the part after # names the part on screen: …/#vocabulary, #progress,
  // #browse, #tools, #settings (Practice has none). Going to a part adds a step to the browser's history, so ← back and forward
  // step through the parts, and a link or bookmark opens the part it names. A practice and its results add no step.
  // A shared notebook's link is …/#shared/<its id> (shared-notebooks/preview.js shows what the address names).
  function partHash(v) { return { setup: "", table: "#vocabulary", history: "#progress", settings: "#settings", tools: "#tools", browse: "#browse", shared: "#shared/" + sharedId() }[v]; }
  function hashPart() { return ["table", "history", "settings", "tools", "browse", "shared"].find((v) => partHash(v) === location.hash) || "setup"; }
  // From show(): the address follows, unless it's the address that moved (back or forward), or the page is still starting
  // (boot.js opens the part the address names).
  function syncHash(v) {
    const h = partHash(v);
    if (h == null || syncHash.quiet || location.hash === h || !document.body.classList.contains("ready")) return;
    window.history.pushState(null, "", h || location.pathname + location.search); // window.: history is the pads' undo list
  }
  addEventListener("popstate", () => {
    if (!document.body.classList.contains("ready")) return;
    syncHash.quiet = true;
    try { go(hashPart()); } finally { syncHash.quiet = false; }
  });

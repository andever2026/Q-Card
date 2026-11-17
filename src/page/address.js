  // ---------- each part of the page has its own address (public site) ----------
  // The page loads once and swaps what it shows, so the part after # names the part on screen: …/#vocabulary, #progress,
  // #browse, #tools, #settings (Practice has none). Going to a part adds a step to the browser's history, so ← back and forward
  // step through the parts, and a link or bookmark opens the part it names. A practice and its results add no step.
  // A shared notebook's link is …/#shared/<its id> (shared-notebooks/preview.js shows what the address names), a group's
  // join link …/#join/<its id> (groups/links.js).
  function partHash(v) { return { setup: "", table: "#vocabulary", history: "#progress", settings: "#settings", tools: "#tools", browse: "#browse", shared: "#shared/" + sharedId(), join: "#join/" + joinId() }[v]; }
  function hashPart() { return ["table", "history", "settings", "tools", "browse", "shared", "join"].find((v) => partHash(v) === location.hash) || "setup"; }
  // From show(): the address follows, unless it's the address that moved (back or forward), or the page is still starting
  // (boot.js opens the part the address names).
  function syncHash(v) {
    const h = partHash(v);
    if (h == null || syncHash.quiet || location.hash === h || !document.body.classList.contains("ready")) return;
    window.history.pushState(null, "", h || location.pathname + location.search); // window.: history is the pads' undo list
  }
  // A link to one of those: the site's address with its part. A link's id is long and random, since having the link is what
  // lets someone look (a shared notebook) or join (a group).
  // The id in an address …/#<part>/<id>, or "".
  function hashId(part) { const m = location.hash.match(/^#([a-z]+)\/([A-Za-z0-9]{20,40})$/); return m?.[1] === part ? m[2] : ""; }
  function linkTo(hash) { return `${location.origin}${location.pathname}${hash}`; }
  function newLinkId() { return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 56]).join(""); }
  // A link in a box (selected when it's clicked) with a Copy link button.
  function copyLink(btn, box) { box.onfocus = () => box.select(); btn.onclick = async () => { try { await navigator.clipboard.writeText(box.value); btn.textContent = "Copied"; } catch { box.focus(); } }; }
  // A link's page asks a visitor to sign in for some things, and the page starts over on signing in: the link waits in this
  // tab's session storage, and boot.js opens it again.
  function linkWait(hash = "") { try { if (hash) sessionStorage.setItem("qcard:link", hash); else sessionStorage.removeItem("qcard:link"); } catch {} }
  function resumeLink() {
    let hash = "";
    try { hash = sessionStorage.getItem("qcard:link") || ""; } catch {}
    linkWait();
    if (!account || !/^#(shared|join)\/[A-Za-z0-9]{20,40}$/.test(hash)) return;
    window.history.replaceState(null, "", hash);
    openView(hashPart());
  }
  addEventListener("popstate", () => {
    if (!document.body.classList.contains("ready")) return;
    syncHash.quiet = true;
    try { go(hashPart()); } finally { syncHash.quiet = false; }
  });

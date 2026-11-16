  // ---------- Extra tools (public site) ----------
  // A view of the page like the others, with the menu beside it. Its tools are js/tools.js (src/study-tools/tools.js),
  // loaded the first time it opens, so the page itself doesn't carry them. Its address is #tools (page/address.js; the old
  // study-tools/ page sends people there).
  let toolsLoaded = false;
  function openTools() {
    show("tools");
    if (toolsLoaded) return;
    toolsLoaded = true;
    const s = Object.assign(document.createElement("script"), { src: "js/tools.js" });
    s.onerror = () => { toolsLoaded = false; $("#toolList").innerHTML = `<p class="muted small">The tools couldn't load. Check your connection and open Extra tools again.</p>`; };
    document.head.append(s);
  }

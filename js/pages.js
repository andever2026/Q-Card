// Made by tools/build.mjs from src/side-pages/pages.js; edit that file instead.
// The side pages (ai/, privacy/): the colours and light or dark picked in the site's Settings, and on the AI page its Copy and
// Import buttons. Loaded in <head>, so the colours are right before anything shows. Without it the pages still read fine.
(() => {
  const html = document.documentElement;
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const colours = () => {
    if (get("jpq:palette") === "claude") html.dataset.palette = "claude"; else delete html.dataset.palette;
    const t = get("jpq:theme");
    if (t === "light" || t === "dark") html.dataset.theme = t; else delete html.dataset.theme;
  };
  colours();
  addEventListener("storage", colours); // changed in Settings in another tab
  html.classList.add("js");

  addEventListener("DOMContentLoaded", () => {
    const $ = (s) => document.querySelector(s);
    if (!$("#ask")) return;
    // The message names this page as it's served (so the beta page names itself); opened from disk, the live link stays.
    if (/^https?:$/.test(location.protocol)) $("#pageLink").textContent = location.origin + location.pathname;
    $("#copyBtn").onclick = async () => {
      const b = $("#copyBtn");
      try { await navigator.clipboard.writeText($("#askText").textContent); b.textContent = "Copied"; }
      catch { getSelection().selectAllChildren($("#askText")); b.textContent = "Selected"; } // no clipboard here: they copy it themselves
      clearTimeout(b.reset); b.reset = setTimeout(() => (b.textContent = "Copy"), 2500);
    };

    // Import: the file is left in this tab's session storage and the site opens, showing the same preview as Settings → Import.
    const say = (m) => { $("#aiImportMsg").hidden = !m; $("#aiImportMsg").textContent = m; };
    $("#aiImportBtn").onclick = () => { $("#aiImportFile").value = ""; $("#aiImportFile").click(); };
    $("#aiImportFile").onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      say("");
      const text = await f.text();
      let file = null;
      try { file = JSON.parse(text); } catch {}
      if (!file) return say("That file couldn't be read. Pick the .json file your AI made.");
      if (file.app !== "jp-vocab-practice" || !Array.isArray(file.sets)) return say("This isn't a Japanese Vocab Practice file. Ask your AI to make it the way this page says.");
      try { sessionStorage.setItem("jpq:aiImport", JSON.stringify({ name: f.name, text })); }
      catch { return say("This file is too big to open from here. Import it in Settings (the gear) on the site instead."); }
      location.assign(location.protocol === "file:" ? "../index.html" : "../");
    };
  });
})();

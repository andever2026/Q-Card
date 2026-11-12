  // ---------- Settings (the gear in the header) ----------
  // A page of its own: tabs down the left, the picked tab's part beside them. Each part is drawn by the code it belongs
  // to (theme/pick.js, account/account.js, import-export/panel.js, practice/history.js, account/share.js); this file is
  // the page around them. On a phone the tabs are a list and picking one opens it, so there no tab is picked at first.
  const phone = matchMedia("(max-width: 640px)");
  let setFrom = "setup", setTab = null;
  const setNav = [...document.querySelectorAll("#setNav [data-set-tab]")], setPane = (tab) => $(`[data-set-pane="${tab}"]`);
  // tab: open straight on that tab (the empty page's Import does).
  function openSettings(tab) {
    if ($("#settings").hidden) setFrom = views.find((v) => !$("#" + v).hidden) || "setup";
    setTab = tab ?? (phone.matches ? null : setTab);
    renderSettings(); show("settings");
  }
  // Leaving a tab drops what was half done on it, such as a Delete waiting for its confirmation ("leave" tells its code).
  const leaveTab = () => $("#settings").dispatchEvent(new Event("leave"));
  function closeSettings() {
    leaveTab(); show(setFrom);
    // What Settings changed (history off, an import) shows on the page it was opened from.
    if (setFrom === "history") renderHistory(); else if (setFrom === "table") renderTable();
  }
  $("#settingsBtn").onclick = () => ($("#settings").hidden ? openSettings() : closeSettings());
  $("#settingsClose").onclick = () => {
    if (!phone.matches || setTab == null) return closeSettings();
    leaveTab(); setTab = null; renderSettings(); window.scrollTo(0, 0);
  };
  setNav.forEach((b) => (b.onclick = () => { leaveTab(); setTab = b.dataset.setTab; renderSettings(); if (phone.matches) { window.scrollTo(0, 0); $("#settingsClose").focus(); } }));
  phone.addEventListener("change", () => { if (!$("#settings").hidden) renderSettings(); });
  // Which tabs are listed and which one shows. A tab with nothing for this viewer (handwriting sharing, where it isn't
  // offered) is left out, so whatever changes that calls this too.
  function syncSetTabs() {
    setNav.forEach((b) => (b.hidden = setPane(b.dataset.setTab).hidden));
    const open = setNav.filter((b) => !b.hidden).map((b) => b.dataset.setTab);
    if (!open.includes(setTab)) setTab = phone.matches ? null : open[0];
    setNav.forEach((b) => (b.dataset.setTab === setTab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    open.forEach((t) => setPane(t).classList.toggle("on", t === setTab));
    $("#settings .setpage").classList.toggle("intab", setTab != null);
    $("#settingsClose").textContent = phone.matches && setTab != null ? "← Settings" : "← Back";
  }
  function renderSettings() {
    const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`, words = S.sets.reduce((a, s) => a + readyCount(s.words || []), 0);
    $("#setStats").textContent = [n(S.sets.length, "set"), n(words, "word"), n(S.kanjiLists.length, "kanji list"), ...(S.history?.length ? [n(S.history.length, "practice session") + " saved"] : [])].join(" · ");
    renderPort(); renderHistSet();
    //#if public
    renderAccount(); renderShare();
    //#endif
    syncSetTabs();
  }

  // ---------- the menu: a sidebar on a big screen, ☰ on a smaller one ----------
  // Practice, Vocab table, History (and Study tools, a page of its own, on the public site). The gear for Settings is at
  // the right end of the top bar (beside the account on the public site, account/menu.js, whose menu has Settings too).
  // On a big screen the menu is a sidebar down the left, and ☰ beside the title shrinks it to its icons. On Settings, Settings'
  // tabs take the sidebar and ☰ brings the menu in over the page (as YouTube does). On a smaller screen the header is a
  // top bar: ☰ slides the menu in from the left, the gear opens and closes Settings, and Settings' tabs stay on its page.
  // It steps aside while writing, like the rest of the header. What show() reaches (markNav and the functions it calls)
  // only uses the page, so it works before this file has run.
  function htmlCls() { return document.documentElement.classList; }
  function wideScreen() { return matchMedia("(min-width: 1000px)"); } // where page/styles.css turns the sidebar on
  function isWide() { return wideScreen().matches; }
  const goBtns = [...document.querySelectorAll("#sideNav [data-go]")];
  const viewNow = () => views.find((v) => !$("#" + v).hidden) || "setup";
  function openView(v) {
    if (v === "settings") openSettings();
    else if (v === "history") openHistory();
    else if (v === "table") { renderTable(); show("table"); }
    else { show("setup"); renderSetup(); }
  }
  // Going somewhere from the menu. Unsaved changes in the vocab table are asked about first, wherever to (vocab/table.js).
  function go(v) {
    menu(false);
    const from = viewNow();
    if (from === v) return;
    if (from === "table") return leaveTable(v);
    if (from === "settings") leaveTab();
    openView(v);
  }
  // Called by show() for every view: a practice's results count as Practice.
  function markNav(v) {
    const at = v === "results" ? "setup" : v;
    markCurrent([...document.querySelectorAll("#sideNav [data-go]")], (b) => b.dataset.go === at);
    markCurrent([$("#settingsBtn")], () => at === "settings");
    $("#setNavSlot").hidden = at !== "settings";
    htmlCls().toggle("setview", at === "settings"); layMenu();
  }
  // The menu is a drawer (html.drawer: ☰ slides it in over the page) on a smaller screen and on Settings, else the sidebar.
  // Settings' tabs: in the sidebar on a big screen, at the side of the Settings page otherwise (a list on a phone).
  function layMenu() {
    const drawer = !isWide() || htmlCls().contains("setview"), tabsIn = isWide() ? $("#setNavSlot") : $("#settings .setpage");
    if (!drawer) menu(false);
    htmlCls().toggle("drawer", drawer); syncMenuBtn();
    if ($("#setNav").parentElement !== tabsIn) tabsIn.prepend($("#setNav"));
  }
  // The drawer: picking a page, Escape, a tap beside it or leaving it with Tab closes it.
  function menu(open, refocus) {
    const side = $("header.side");
    if (open === side.classList.contains("open")) return;
    side.classList.toggle("open", open); syncMenuBtn();
    if (open) $("#sideNav > *").focus(); else if (refocus) $("#menuBtn").focus();
  }
  // The sidebar shrunk to its icons, each named when pointed at. Kept for this device only.
  function shrink(on) {
    htmlCls().toggle("sidemini", on);
    [...$("#sideNav").children].forEach((b) => (on ? (b.title = b.textContent.trim()) : b.removeAttribute("title")));
    syncMenuBtn();
  }
  function syncMenuBtn() { $("#menuBtn").setAttribute("aria-expanded", htmlCls().contains("drawer") ? $("header.side").classList.contains("open") : !htmlCls().contains("sidemini")); }
  goBtns.forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $("#settingsBtn").onclick = () => (viewNow() === "settings" && !isWide() ? closeSettings() : go("settings"));
  $("#menuBtn").onclick = () => {
    if (htmlCls().contains("drawer")) return menu(!$("header.side").classList.contains("open"));
    shrink(!htmlCls().contains("sidemini")); store.set("sideMini", htmlCls().contains("sidemini"));
  };
  $("#sideShade").onclick = () => menu(false, true);
  $("header.side").addEventListener("keydown", (e) => { if (e.key === "Escape" && $("header.side").classList.contains("open")) menu(false, true); });
  // (Not when the focus goes to ☰: its click closes the menu itself.)
  $("#sideNav").addEventListener("focusout", (e) => { if (e.relatedTarget && e.relatedTarget.id !== "menuBtn" && !$("#sideNav").contains(e.relatedTarget)) menu(false); });
  wideScreen().addEventListener("change", layMenu);
  shrink(store.get("sideMini", false) === true); markNav(viewNow());

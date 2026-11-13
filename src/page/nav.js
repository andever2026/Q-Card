  // ---------- the menu: a sidebar on a big screen, ☰ on a smaller one ----------
  // Practice, Vocab table, History (and Study tools, a page of its own, on the public site), with Settings at the bottom.
  // On a big screen it's a sidebar down the left, and while Settings is open its tabs sit under it there; ☰ beside the
  // title shrinks it to its icons. On a smaller screen the header is a top bar: ☰ slides the same menu in from the left,
  // and the gear opens and closes Settings. It steps aside while writing, like the rest of the header.
  const wide = matchMedia("(min-width: 1000px)"); // where page/styles.css turns the sidebar on
  const side = $("header.side"), goBtns = () => [...document.querySelectorAll("#sideNav [data-go]")];
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
  // Called by show() for every view (so a function, ready before this file has run): a practice's results count as Practice.
  function markNav(v) {
    const at = v === "results" ? "setup" : v;
    markCurrent(goBtns(), (b) => b.dataset.go === at);
    markCurrent([$("#settingsBtn")], () => at === "settings");
    $("#setNavSlot").hidden = at !== "settings";
  }
  goBtns().forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $("#settingsBtn").onclick = () => (viewNow() === "settings" && !wide.matches ? closeSettings() : go("settings"));

  // ☰ on a smaller screen: the menu slides in over the page; picking a page, Escape, a tap beside it or leaving it with
  // Tab closes it.
  function menu(open, refocus) {
    if (open === side.classList.contains("open")) return;
    side.classList.toggle("open", open); syncMenuBtn();
    if (open) $("#sideNav > *").focus(); else if (refocus) $("#menuBtn").focus();
  }
  // ☰ on a big screen: the sidebar shrinks to its icons, each named when pointed at. Kept for this device only.
  let mini = store.get("sideMini", false) === true;
  function shrink(on) {
    mini = on; document.documentElement.classList.toggle("sidemini", mini);
    [...$("#sideNav").children].forEach((b) => (mini ? (b.title = b.textContent.trim()) : b.removeAttribute("title")));
    syncMenuBtn(); placeSetTabs();
  }
  const syncMenuBtn = () => $("#menuBtn").setAttribute("aria-expanded", wide.matches ? !mini : side.classList.contains("open"));
  $("#menuBtn").onclick = () => { if (!wide.matches) return menu(!side.classList.contains("open")); shrink(!mini); store.set("sideMini", mini); };
  $("#sideShade").onclick = () => menu(false, true);
  side.addEventListener("keydown", (e) => { if (e.key === "Escape" && side.classList.contains("open")) menu(false, true); });
  $("#sideNav").addEventListener("focusout", (e) => { if (e.relatedTarget && !$("#sideNav").contains(e.relatedTarget)) menu(false); });

  // Settings' tabs: in the sidebar on a big screen (unless it's shrunk to icons), at the side of the Settings page
  // otherwise (a list on a phone).
  function placeSetTabs() { if (wide.matches && !mini) $("#setNavSlot").append($("#setNav")); else $("#settings .setpage").prepend($("#setNav")); }
  wide.addEventListener("change", () => { menu(false); syncMenuBtn(); placeSetTabs(); });
  shrink(mini); markNav(viewNow());

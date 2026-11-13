  // ---------- public site: the account at the top right ----------
  // Beside the gear: a guest says so, and its menu offers signing in. Signed in, the gear steps aside and the person's
  // nickname (or their Google name) opens a menu with Settings and Sign out. The nickname is the account's own,
  // data/users/<uid>/profile, set in Settings → Account.
  let nickname = "";
  const shownName = () => nickname || account?.name || String(account?.email || "").split("@")[0] || "Account";
  const acctOpen = () => !$("#acctList").hidden;
  function acctMenu(open, refocus) {
    $("#acctList").hidden = !open; $("#acctBtn").setAttribute("aria-expanded", open);
    if (open) $("#acctList button").focus(); else if (refocus) $("#acctBtn").focus();
  }
  function renderAcctMenu() {
    $("#settingsBtn").hidden = !!account;
    $("#acctLabel").textContent = account ? shownName() : "Guest";
    $("#acctBtn").setAttribute("aria-label", account ? `${shownName()}: account menu` : "Guest: account menu");
    // The gear is the top bar's own, smaller.
    const gear = () => $("#settingsBtn svg").outerHTML.replace('width="22" height="22"', 'width="18" height="18"');
    const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    $("#acctList").innerHTML = account
      ? `<p class="small muted">Signed in as <b>${esc(account.email || account.name)}</b></p>
        <button type="button" role="menuitem" data-acct="settings">${gear()}Settings</button>
        <button type="button" role="menuitem" data-acct="signout">${icon("M14.5 4.5 H18.5 a1.5 1.5 0 0 1 1.5 1.5 V18 a1.5 1.5 0 0 1-1.5 1.5 H14.5 M10 8 L6 12 L10 16 M6 12 H15.5")}Sign out</button>`
      : `<p class="small muted">Not signed in. Your sets and history are kept in this browser.</p>
        <button type="button" role="menuitem" data-acct="signin">${icon("M9.5 4.5 H5.5 a1.5 1.5 0 0 0-1.5 1.5 V18 a1.5 1.5 0 0 0 1.5 1.5 H9.5 M14 8 L18 12 L14 16 M18 12 H8.5")}Sign in with Google</button>`;
    const item = (k) => $(`#acctList [data-acct="${k}"]`);
    if (account) {
      item("settings").onclick = () => { acctMenu(false); go("settings"); };
      item("signout").onclick = () => { acctMenu(false); platform.signOut(); };
    } else item("signin").onclick = (e) => signIn(e.currentTarget, (m) => { acctMenu(false); banner(m); });
  }
  $("#acctBtn").onclick = () => acctMenu(!acctOpen());
  // Arrow keys move between the items; Escape, Tab or a click anywhere else closes the menu.
  $("#acct").addEventListener("keydown", (e) => {
    if (!acctOpen()) return;
    const items = [...$("#acctList").querySelectorAll("button")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") acctMenu(false, true);
    else if (e.key === "Tab") acctMenu(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
  });
  document.addEventListener("pointerdown", (e) => { if (acctOpen() && !$("#acct").contains(e.target)) acctMenu(false); });

  // The nickname: kept with the account, shown at the top right, changed in Settings → Account.
  const profileRef = () => db.doc(`data/users/${uid}/profile`);
  function watchProfile() {
    profileRef().onSnapshot((snap) => { nickname = tidy(snap.exists ? snap.data()?.nickname : "", 40); renderAcctMenu(); renderNick(); }, () => {});
  }
  function renderNick() {
    $("#nickRow").hidden = !account;
    if (!account || document.activeElement === $("#nickIn")) return;
    $("#nickIn").value = nickname; $("#nickIn").placeholder = account.name || "Your name"; syncNick();
  }
  // msg: what saving said; left out, what's there stays.
  const syncNick = (msg) => { $("#nickSave").disabled = tidy($("#nickIn").value, 40) === nickname; if (msg != null) $("#nickMsg").textContent = msg; };
  $("#nickIn").addEventListener("input", () => syncNick(""));
  $("#settings").addEventListener("leave", () => syncNick(""));
  $("#nickForm").onsubmit = async (e) => {
    e.preventDefault();
    const v = tidy($("#nickIn").value, 40), b = $("#nickSave");
    b.disabled = true; b.textContent = "Saving…";
    try { await profileRef().set({ nickname: v, updatedAt: new Date().toISOString() }); nickname = v; $("#nickIn").value = v; renderAcctMenu(); syncNick(v ? "Saved." : "Saved. Your Google name shows instead."); }
    catch { syncNick("Couldn't save. Try again."); }
    b.textContent = "Save";
  };

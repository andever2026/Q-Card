  // ---------- inviting someone to a group by their email address (public site) ----------
  // Whoever may invite types someone's email address and a role (one they could give): the invite is
  // groupMail/<group>_<address> { group, name, email, role, by, at } (firestore.rules). Nothing is emailed, since the site has
  // no server to send it from, so each invite has a message to copy and send them. Whoever signs in with that address (once
  // Google has checked it) finds the invite in their notebook menu, with Join and Decline.
  const okEmail = (v) => v.length <= 254 && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v);
  const inviteText = (name, email) => `I invited you to “${name}”, a group on Japanese Vocab Practice. To join, sign in at ${linkTo("")} with ${email}, then open the notebook menu.`;

  // In the group's settings, for whoever may invite: the address and role, Invite, and the group's invites not yet answered.
  // (They're read once the settings open, and drawn again then.)
  const invitesOf = async (id) => (await platform.groupMail.where("group", "==", id).get()).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  gsMore.push({
    html: (g, s) => !perm(g, "invite") ? "" : `<section><h4>Invite by email</h4><div class="gsrow"><input class="tsearch" id="gsMailIn" type="email" maxlength="254" aria-label="Their email address" placeholder="Their email address" value="${esc(s.mailDraft || "")}">
      <span id="gsMailRole"></span><button class="btn" type="button" id="gsMailGo">Invite</button></div>
      <p class="small muted">Nothing is emailed: copy the invite message and send it to them. Once they sign in with that address, the invite is in their notebook menu.</p>
      ${s.mail?.length ? `<ul class="gslist">${s.mail.map((v) => `<li><span class="gsn">${esc(v.email)} <span class="small muted">as ${esc(roleName(g, v.role))}</span></span>
        <button class="link" type="button" data-mail-copy="${esc(v.id)}">Copy invite message</button><button class="link danger" type="button" data-mail-off="${esc(v.id)}">Cancel</button></li>`).join("")}</ul>` : ""}</section>`,
    wire: (g, s) => {
      if (!s.q("#gsMailIn")) return;
      if (!s.mail) { s.mail = []; invitesOf(g.id).then((list) => { s.mail = list; s.draw(); }, () => {}); }
      const givable = rolesInOrder(g).filter((r) => canGive(g, r)), box = s.q("#gsMailIn");
      let role = s.mailRole || (givable.includes("member") ? "member" : givable[0]);
      makeDropdown(s.q("#gsMailRole"), "Role", givable.map((r) => [r, roleName(g, r)]), (r) => (role = s.mailRole = r)).set(role);
      box.oninput = () => (s.mailDraft = box.value);
      box.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); s.q("#gsMailGo").click(); } };
      s.q("#gsMailGo").onclick = async () => {
        const email = box.value.trim().toLowerCase(), id = `${g.id}_${email}`;
        if (!okEmail(email)) return box.focus();
        if (s.mail.some((v) => v.id === id)) return box.select(); // (invited already: it's in the list)
        const v = { group: g.id, name: groupName(g), email, role, by: tidy(g.me.name, 60) || memberName(), at: new Date().toISOString() };
        if (await s.saving(() => platform.groupMail.doc(id).set(v))) { s.mail = [...s.mail, { id, ...v }]; s.mailDraft = ""; s.draw(); }
      };
      s.each("[data-mail-copy]", (b) => (b.onclick = async () => {
        const v = s.mail.find((x) => x.id === b.dataset.mailCopy);
        // (Where copying isn't allowed, the message is shown in a box to copy from instead.)
        try { await navigator.clipboard.writeText(inviteText(groupName(g), v.email)); b.textContent = "Copied"; }
        catch { b.outerHTML = `<input class="tsearch" readonly aria-label="Invite message" data-mail-text value="${esc(inviteText(groupName(g), v.email))}">`; s.q("[data-mail-text]").select(); }
      }));
      s.each("[data-mail-off]", (b) => (b.onclick = async () => { const id = b.dataset.mailOff; if (await s.saving(() => platform.groupMail.doc(id).delete())) { s.mail = s.mail.filter((x) => x.id !== id); s.draw(); } }));
    },
  });
  // Deleting a group takes its invites with it (settings.js, emptyGroup).
  groupGone.push(async (id) => { for (const v of await invitesOf(id)) await platform.groupMail.doc(v.id).delete(); });

  // This account's invites, listened to once it's signed in: under their group's name in the notebook menu, with Join and
  // Decline. One to a group it's in already (it joined by link, say) is just taken away.
  let invites = [], mailOff = null;
  function watchInvites() {
    const email = String(account?.email || "").toLowerCase();
    if (mailOff || !email || !groupIndex) return;
    mailOff = platform.groupMail.where("email", "==", email).onSnapshot((snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, group: String(d.data().group), name: tidy(d.data().name, 60) || "Group", by: tidy(d.data().by, 60) || "Someone", role: String(d.data().role) }));
      for (const v of all.filter((v) => groupIndex.some((x) => x.id === v.group))) platform.groupMail.doc(v.id).delete().catch(() => {});
      invites = all.filter((v) => !groupIndex.some((x) => x.id === v.group));
      renderNotebooks();
    }, () => {});
  }
  nbSections.push(() => invites.filter((v) => !groupIndex?.some((x) => x.id === v.group)).map((v) => `<div class="nbgroup"><span class="small muted">${esc(v.name)}</span></div><p class="small muted nbnone">${esc(v.by)} invited you</p>
    <button type="button" role="menuitem" data-nb-do="joinInvite" data-arg="${esc(v.id)}">${nbIcon("M5 12 L10 17 L19 7")}Join</button>
    <button type="button" role="menuitem" data-nb-do="declineInvite" data-arg="${esc(v.id)}">${nbIcon("M6 6 L18 18 M18 6 L6 18")}Decline</button>`).join(""));
  // Joining takes the invite away in the same write, as firestore.rules wants it.
  nbActs.joinInvite = async (id) => {
    const v = invites.find((x) => x.id === id);
    if (!v) return;
    if (groupsFull()) return;
    const line = { name: memberName(), role: v.role, joinedAt: new Date().toISOString(), via: "mail" };
    try { await platform.together([[platform.group(v.group).db.doc("members/" + uid), line], [platform.groupMail.doc(id), null]]); }
    catch { return banner("Couldn't join. The invite may have been cancelled."); }
    invites = invites.filter((x) => x !== v);
    await saveGroups(groupIndex.some((x) => x.id === v.group) ? groupIndex : [...groupIndex, { id: v.group, name: v.name }]);
  };
  nbActs.declineInvite = async (id) => {
    try { await platform.groupMail.doc(id).delete(); } catch { return banner("Couldn't do that. Try again."); }
    invites = invites.filter((x) => x.id !== id); renderNotebooks();
  };
  // Deleting the account (settings.js, leaveGroups): the invites to its address go too.
  groupBye.push(async () => {
    mailOff?.(); mailOff = null;
    for (const v of invites) await platform.groupMail.doc(v.id).delete().catch(() => {});
  });
  groupHooks.push(watchInvites);

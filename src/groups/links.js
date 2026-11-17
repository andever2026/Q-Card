  // ---------- joining a group by link (public site) ----------
  // Whoever may invite makes the group's join link in its settings, with the role people join with (one they could give)
  // and whether each person asks first. The group keeps it as link { token, role, approve }, and groupLinks/<token> tells the
  // page the link opens (…/#join/<token>) the group's name, for anyone (firestore.rules). Signed in, someone with the link
  // joins at once, or asks (groups/<id>/requests/<their id>) and waits for whoever may approve requests to let them in or
  // turn them down; the account keeps its asks in its list of groups (asked) until then. A new link, or none, stops the
  // old one working.
  const joinLink = (token) => linkTo("#join/" + token);
  function joinId() { return hashId("join") || joinId.at || ""; }

  // The group's link changed: link is { token, role, approve } or null. groupLinks/<token> follows, in the same write.
  async function setLink(g, link) {
    const was = g.info.link, writes = [[platform.group(g.id).info, { link }, "update"]];
    if (was && was.token !== link?.token) writes.push([platform.groupLink(was.token), null]);
    if (link) writes.push([platform.groupLink(link.token), { group: g.id, name: groupName(g), role: link.role, approve: link.approve }]);
    await platform.together(writes);
    g.info = { ...g.info, link };
  }
  // Deleting a group takes its link's page with it (settings.js, emptyGroup).
  groupGone.push(async (id, info) => { if (info?.link?.token) await platform.groupLink(info.link.token).delete(); });

  // In the group's settings: the join link, for whoever may invite, and the people asking to join, for whoever may let them in.
  gsMore.push({
    html: (g) => {
      if (!perm(g, "invite")) return "";
      const link = g.info.link, mine = !link || canGive(g, link.role);
      return `<section><h4>Join link</h4>${link ? `<input class="tsearch" id="gsLinkIn" readonly aria-label="Join link" value="${esc(joinLink(link.token))}">
        <p class="tactions"><button class="btn" type="button" id="gsLinkCopy">Copy link</button>${mine ? `<button class="link" type="button" id="gsLinkNew">New link</button>` : ""}<button class="link danger" type="button" id="gsLinkOff">Turn off</button></p>`
        : `<p class="small muted">Anyone who has the link can join, with the role you pick.</p>`}
        <div class="gsrow"><span class="small">People join as</span>${mine ? `<span id="gsLinkRole"></span>` : `<span class="small muted">${esc(roleName(g, link.role))}</span>`}</div>
        <label class="checkrow"><input type="checkbox" id="gsLinkAsk"${link?.approve ? " checked" : ""}${mine ? "" : " disabled"}> Each person asks first, and waits to be let in</label>
        ${link ? `<p class="small muted">A new link, or turning this one off, stops it working.</p>` : `<p class="tactions"><button class="btn primary" type="button" id="gsLinkMake">Make a link</button></p>`}</section>`;
    },
    wire: (g, s) => {
      if (!s.q("#gsLinkAsk")) return;
      const link = g.info.link, givable = rolesInOrder(g).filter((r) => canGive(g, r)), save = async (v) => { if (await s.saving(() => setLink(g, v))) s.draw(); };
      let role = link?.role || (givable.includes("member") ? "member" : givable[0]);
      if (s.q("#gsLinkRole")) makeDropdown(s.q("#gsLinkRole"), "People join as", givable.map((r) => [r, roleName(g, r)]), (r) => { role = r; if (link) save({ ...link, role }); }).set(role);
      s.q("#gsLinkAsk").onchange = (e) => { if (link) save({ ...link, approve: e.target.checked }); };
      if (!link) return void (s.q("#gsLinkMake").onclick = () => save({ token: newLinkId(), role, approve: s.q("#gsLinkAsk").checked }));
      copyLink(s.q("#gsLinkCopy"), s.q("#gsLinkIn"));
      if (s.q("#gsLinkNew")) s.q("#gsLinkNew").onclick = () => save({ ...link, token: newLinkId() });
      s.q("#gsLinkOff").onclick = () => save(null);
    },
  });
  gsMore.push({
    html: (g) => {
      const list = perm(g, "approve") ? asking.get(g.id)?.list || [] : [];
      return !list.length ? "" : `<section><h4>Asking to join (${list.length})</h4><ul class="gslist">${list.map((r) => `<li><span class="gsn">${esc(r.name)} <span class="small muted">as ${esc(roleName(g, r.role))}</span></span>
        <button class="btn" type="button" data-let-in="${esc(r.id)}">Let in</button><button class="link danger" type="button" data-turn-down="${esc(r.id)}">Turn down</button></li>`).join("")}</ul></section>`;
    },
    wire: (g, s) => {
      const at = platform.group(g.id), w = asking.get(g.id), take = (r) => { if (w) w.list = w.list.filter((x) => x !== r); };
      const of = (id) => w?.list.find((r) => r.id === id);
      s.each("[data-let-in]", (b) => (b.onclick = async () => {
        const r = of(b.dataset.letIn), line = { name: r.name, role: r.role, joinedAt: new Date().toISOString(), via: "approved" };
        if (await s.saving(() => platform.together([[at.db.doc("members/" + r.id), line], [at.db.doc("requests/" + r.id), null]]))) { take(r); s.people.push({ id: r.id, ...line }); s.draw(); }
      }));
      s.each("[data-turn-down]", (b) => (b.onclick = async () => { const r = of(b.dataset.turnDown); if (await s.saving(() => at.db.doc("requests/" + r.id).delete())) { take(r); s.draw(); } }));
    },
  });

  // People asking to join, listened to in each group where this account may let them in, and shown under the group's
  // notebooks in the notebook menu.
  const asking = new Map(); // group id → { list: [{ id, name, role, token, at }], off }
  function syncAsking() {
    for (const [id, w] of asking) if (!perm(groups.get(id), "approve")) { w.off(); asking.delete(id); }
    for (const g of groups.values()) if (groupReady(g) && perm(g, "approve") && !asking.has(g.id)) {
      const w = { list: [], off: () => {} };
      asking.set(g.id, w);
      w.off = platform.group(g.id).db.collection("requests").onSnapshot((snap) => {
        w.list = snap.docs.map((d) => ({ id: d.id, ...d.data(), name: tidy(d.data().name, 60) || "Someone" })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
        renderNotebooks();
      }, () => {});
    }
  }
  groupMore = (g) => {
    const n = asking.get(g.id)?.list.length;
    return n ? `<button type="button" role="menuitem" data-nb-do="groupSettings" data-arg="${esc(g.id)}">${nbIcon("M15 19 v-1.5 a3.5 3.5 0 0 0 -3.5 -3.5 h-4 A3.5 3.5 0 0 0 4 17.5 V19 M9.5 10.5 a3 3 0 1 0 0 -6 a3 3 0 0 0 0 6 M19 8 V14 M16 11 H22")}${n} ${n > 1 ? "people" : "person"} asking to join</button>` : "";
  };

  // The groups this account asked to join: each request is listened to until it goes, and then whether this account is in
  // the group says which way it went.
  const askWatch = new Map(); // group id → stop listening
  function syncAsks() {
    for (const [id, off] of askWatch) if (!groupAsked.some((a) => a.id === id)) { off(); askWatch.delete(id); }
    for (const a of groupAsked) if (!askWatch.has(a.id)) askWatch.set(a.id, platform.group(a.id).db.doc("requests/" + uid).onSnapshot((s) => { if (!s.exists) answered(a.id); }, () => answered(a.id)));
  }
  async function answered(id) {
    const a = groupAsked.find((x) => x.id === id);
    if (!a) return;
    askWatch.get(id)?.(); askWatch.set(id, () => {}); // (quiet until it leaves the list)
    const inIt = await platform.group(id).db.doc("members/" + uid).get().then((s) => s.exists, () => false), rest = groupAsked.filter((x) => x.id !== id);
    banner(inIt ? `You're in “${a.name}” now. Its notebooks are in your notebook menu.` : `Your request to join “${a.name}” wasn't accepted.`);
    await saveGroups(inIt && !groupIndex.some((x) => x.id === id) ? [...groupIndex, { id, name: a.name }] : groupIndex, rest);
  }
  async function cancelAsk(id) {
    if (await saveGroups(groupIndex, groupAsked.filter((x) => x.id !== id))) await platform.group(id).db.doc("requests/" + uid).delete().catch(() => {});
  }
  nbActs.cancelAsk = cancelAsk;
  // Deleting the account (settings.js, leaveGroups): its requests go too, without a word about them.
  groupBye.push(async () => {
    for (const off of askWatch.values()) off();
    askWatch.clear();
    for (const a of groupAsked) await platform.group(a.id).db.doc("requests/" + uid).delete().catch(() => {});
  });
  nbSections.push(() => groupAsked.map((a) => `<div class="nbgroup"><span class="small muted">${esc(a.name)}</span></div><p class="small muted nbnone">You asked to join</p>
    <button type="button" role="menuitem" data-nb-do="cancelAsk" data-arg="${esc(a.id)}">${nbIcon("M6 6 L18 18 M18 6 L6 18")}Cancel request</button>`).join(""));

  // The page a join link opens.
  let joinNow; // the link's { token, group, name, role, approve }, null when there's none, undefined while it loads
  let joinFailed = false;
  async function openJoin(id = joinId()) {
    joinId.at = id; joinNow = undefined; joinFailed = false;
    show("join");
    if (!account) linkWait("#join/" + id);
    $("#joinBody").innerHTML = `<div class="empty">Loading…</div>`;
    let l = null;
    try { l = dataOrNull(await platform.groupLink(id).get()); } catch { joinFailed = true; }
    if (joinId.at !== id) return;
    joinNow = l && { token: id, group: String(l.group), name: tidy(l.name, 60) || "Group", role: String(l.role), approve: l.approve === true };
    renderJoin();
  }
  function renderJoin() {
    const l = joinNow, box = $("#joinBody");
    if ($("#join").hidden || l === undefined) return;
    if (!l) return void (box.innerHTML = `<div class="empty"><b>${joinFailed ? "This link couldn't load." : "This link doesn't work any more."}</b><span>${joinFailed ? "Check your connection, then reload the page." : "Ask whoever sent it for a new one."}</span></div>`);
    const g = groups.get(l.group), inIt = groupIndex?.some((x) => x.id === l.group), first = groupReady(g) && g.notebooks[0];
    box.innerHTML = `<div class="head"><h2>${esc(l.name)}</h2></div><p class="muted">A group: notebooks the people in it work on together.</p>
      ${!account ? `<p class="tactions"><button class="btn primary" type="button" id="joinSignIn">Sign in to join</button></p>`
      : !groupIndex ? `<p class="muted">Loading…</p>`
      : inIt ? `<p>You're in this group. ${!groupReady(g) ? "" : first ? "Its notebooks are in your notebook menu." : "It has no notebooks yet."}</p>${first ? `<p class="tactions"><button class="btn primary" type="button" id="joinOpen">Open it</button></p>` : ""}`
      : groupAsked.some((x) => x.id === l.group) ? `<p>You asked to join. You're in once someone in the group lets you in.</p><p class="tactions"><button class="btn" type="button" id="joinCancel">Cancel request</button></p>`
      : `<p class="tactions"><button class="btn primary" type="button" id="joinGo">${l.approve ? "Ask to join" : "Join"}</button></p>
        <p class="muted small">${l.approve ? "Someone in the group lets you in. " : ""}The people in it see the name of your Google account. Once you're in, you can change it in the group's settings.</p>`}`;
    if ($("#joinSignIn")) $("#joinSignIn").onclick = (e) => signIn(e.target, (err) => banner(err || ""));
    if ($("#joinOpen")) $("#joinOpen").onclick = () => { openNotebook(`${g.id}/${first.id}`); go("setup"); };
    if ($("#joinCancel")) $("#joinCancel").onclick = () => cancelAsk(l.group);
    if ($("#joinGo")) $("#joinGo").onclick = (e) => { e.target.disabled = true; joinGroup(l).then(() => (e.target.disabled = false)); };
  }
  async function joinGroup(l) {
    if (groupsFull()) return;
    const at = platform.group(l.group), now = new Date().toISOString();
    try {
      if (l.approve) await at.db.doc("requests/" + uid).set({ name: memberName(), role: l.role, token: l.token, at: now });
      else await at.db.doc("members/" + uid).set({ name: memberName(), role: l.role, joinedAt: now, via: l.token });
    } catch { return banner("Couldn't do that. The link may have just changed: ask whoever sent it for a new one."); }
    // (The request first, so that listening to it finds it there.)
    await (l.approve ? saveGroups(groupIndex, [...groupAsked, { id: l.group, name: l.name, token: l.token }]) : saveGroups([...groupIndex, { id: l.group, name: l.name }]));
  }
  groupHooks.push(syncAsking, syncAsks, renderJoin);

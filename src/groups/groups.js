  // ---------- groups: notebooks several accounts work in together (public site) ----------
  // A group (firestore.rules, platform.group in account/firebase.js) has an owner, roles and members, and notebooks of
  // its own, each with the same documents as any notebook. Nothing lists groups: the account keeps the list of the ones
  // it's in, meta/groups { list: [{ id, name }], asked: [{ id, name, token }] } beside meta/notebooks (asked: the groups it
  // asked to join, groups/links.js). Each group's notebooks are in the notebook menu
  // under its name and open like any notebook, by the id "<group>/<notebook>". What someone may do in a group is their
  // role's (the owner may do everything): without Edit notebooks its notebooks are read only, and Manage notebooks adds,
  // renames and deletes them.
  const GROUP_MAX = 20, PERMS = ["edit", "notebooks", "share", "invite", "approve", "members", "roles"];
  const groupsRef = () => db.doc("meta/groups");
  let groupIndex = null, groupAsked = []; // [{ id, name }] as saved, null until it has loaded; [{ id, name, token }]
  // id → { id, info: groups/<id>, me: this account's line, roles: Map, notebooks: [{ id, name, at }], heard, off }
  const groups = new Map();
  // What else goes when a group is deleted (its join link's page: groups/links.js), each given its id and groups/<id>.
  // What else follows the groups whenever something in them changes (groups/links.js).
  const groupGone = [], groupHooks = [];
  // More lines under a group's notebooks in the notebook menu (people asking to join: groups/links.js).
  let groupMore = (g) => "";
  const groupReady = (g) => g?.heard.size === 4;
  const perm = (g, p) => !!g?.me && (g.me.role === "owner" || g.roles.get(g.me.role)?.perms?.[p] === true);
  const groupName = (g) => tidy(g.info?.name, 60) || groupIndex?.find((x) => x.id === g.id)?.name || "Group";
  const cleanGroups = (list) => (Array.isArray(list) ? list : []).filter((x) => /^[A-Za-z0-9_-]{1,40}$/.test(String(x?.id ?? ""))).slice(0, GROUP_MAX)
    .map((x) => ({ id: x.id, name: tidy(x.name, 60) || "Group", ...(/^[A-Za-z0-9]{20,40}$/.test(String(x.token ?? "")) ? { token: x.token } : {}) }));
  // The name this account goes by in a group it makes or joins: its Google name, which it can change there later.
  const memberName = () => tidy(account?.name, 60) || tidy(account?.email?.split("@")[0], 60) || "Member";
  const splitNb = (id) => { const [g, n] = String(id).split("/"); return n ? { g, n } : null; };

  // The groups' notebooks, as the notebook menu and the rest of the page see them (vocab/notebooks.js).
  nbOthers = () => [...groups.values()].filter(groupReady).flatMap((g) => g.notebooks.map((n) => ({ id: `${g.id}/${n.id}`, name: n.name, group: g.id,
    edit: perm(g, "edit") || perm(g, "notebooks"), ...(perm(g, "notebooks") ? { rename: (name) => saveGroupNb(g, n, name), drop: () => dropGroupNb(g, n) } : {}) })));
  nbPending = (id) => { const x = splitNb(id); return !!x && !!account && (groupIndex === null || (groupIndex.some((y) => y.id === x.g) && !groupReady(groups.get(x.g)))); };
  const ownAt = nbAt;
  nbAt = (id) => { const x = splitNb(id); return x && account ? inNotebook(platform.group(x.g).db, x.n) : ownAt(id); };

  // Listens to the account's list of groups, and to each group in it.
  function watchGroups() {
    groupsRef().onSnapshot((snap) => {
      const d = dataOrNull(snap);
      groupIndex = cleanGroups(d?.list); groupAsked = cleanGroups(d?.asked).filter((x) => x.token);
      // The notebook open in this browser was of a group this account isn't in (another account's, say): that it couldn't
      // load isn't worth a word once another opens.
      const x = splitNb(nb);
      if (x && !groupIndex.some((y) => y.id === x.g) && $("#banner").textContent === watchFailed) banner("");
      syncGroups(); groupsChanged();
    }, () => { groupIndex = []; groupsChanged(); });
  }
  function syncGroups() {
    for (const id of groups.keys()) if (!groupIndex.some((x) => x.id === id)) stopGroup(id);
    for (const { id } of groupIndex) if (!groups.has(id)) watchGroup(id);
  }
  function stopGroup(id) { groups.get(id)?.off.forEach((off) => off()); groups.delete(id); }
  function watchGroup(id) {
    const g = { id, info: null, me: null, roles: new Map(), notebooks: [], heard: new Set(), off: [] }, at = platform.group(id);
    const hear = (what, on) => (snap) => { if (groups.get(id) !== g) return; on(snap); if (groups.get(id) !== g) return; g.heard.add(what); groupsChanged(g); };
    const lost = () => lostGroup(g);
    groups.set(id, g);
    // Its own line going (taken out of the group, or the group deleted) or no longer readable is how this account learns it's not in it.
    g.off = [at.db.doc("members/" + uid).onSnapshot(hear("me", (s) => { g.me = dataOrNull(s); if (!g.me) lost(); }), lost),
      at.info.onSnapshot(hear("info", (s) => (g.info = dataOrNull(s))), lost),
      at.db.collection("roles").onSnapshot(hear("roles", (s) => (g.roles = new Map(s.docs.map((d) => [d.id, d.data()])))), lost),
      at.db.collection("notebooks").onSnapshot(hear("notebooks", (s) => (g.notebooks = s.docs.map((d) => ({ id: d.id, name: tidy(d.data().name, 60) || NB_NAME, at: String(d.data().at || "") }))
        .sort((a, b) => a.at.localeCompare(b.at) || coll.compare(a.name, b.name)))), lost)];
  }
  async function lostGroup(g) {
    if (groups.get(g.id) !== g) return;
    stopGroup(g.id);
    banner(`You're no longer in “${groupName(g)}”.`);
    await saveGroups(groupIndex.filter((x) => x.id !== g.id));
  }
  // Whatever shows a group follows it: the menu, and whether the open notebook can be changed (only when that changes,
  // so nobody's typing is drawn over).
  function groupsChanged(g) {
    if (g?.info && groupIndex.some((x) => x.id === g.id && x.name !== groupName(g))) saveGroups(groupIndex.map((x) => (x.id === g.id ? { ...x, name: groupName(g) } : x)));
    if (!openNotebook(nb)) renderNotebooks(); // (out of a group whose notebook is open: the first notebook opens)
    followEdit();
    groupHooks.forEach((f) => f());
  }
  async function saveGroups(list, asked = groupAsked) {
    groupIndex = list; groupAsked = asked; syncGroups(); groupsChanged();
    try { await groupsRef().set({ list, asked, updatedAt: new Date().toISOString() }); return true; } catch { banner("Couldn't save that. Try again."); return false; }
  }

  // Each group in the notebook menu: its name, its notebooks, and New notebook there for whoever may add them.
  nbSections.push((button) => (groupIndex || []).map(({ id, name }) => {
    const g = groups.get(id), ready = groupReady(g);
    return `<div class="nbgroup"><span class="small muted">${esc(g ? groupName(g) : name)}</span>${ready ? `<button type="button" role="menuitem" data-nb-do="groupSettings" data-arg="${esc(id)}" aria-label="Settings of ${esc(groupName(g))}" title="Group settings">${nbIcon("M19.3 10 L21.9 10.5 L21.9 13.5 L19.3 14 L18.6 15.7 L20.1 17.9 L17.9 20.1 L15.7 18.6 L14 19.3 L13.5 21.9 L10.5 21.9 L10 19.3 L8.3 18.6 L6.1 20.1 L3.9 17.9 L5.4 15.7 L4.7 14 L2.1 13.5 L2.1 10.5 L4.7 10 L5.4 8.3 L3.9 6.1 L6.1 3.9 L8.3 5.4 L10 4.7 L10.5 2.1 L13.5 2.1 L14 4.7 L15.7 5.4 L17.9 3.9 L20.1 6.1 L18.6 8.3Z M15.2 12 a3.2 3.2 0 1 1 -6.4 0 a3.2 3.2 0 0 1 6.4 0")}</button>` : ""}</div>${!ready ? `<p class="small muted nbnone">Loading…</p>`
      : g.notebooks.map((n) => button({ id: `${id}/${n.id}`, name: n.name })).join("") || `<p class="small muted nbnone">No notebooks yet</p>`}${ready ? groupMore(g) : ""}
      ${ready && canWrite && perm(g, "notebooks") ? `<button type="button" role="menuitem" data-nb-do="groupNb" data-arg="${esc(id)}">${nbIcon("M12 5 V19 M5 12 H19")}New notebook in ${esc(groupName(g))}</button>` : ""}`;
  }).join(""));

  // New group: made with its owner (this account) and two starting roles, all in one write, then added to the account's list.
  const role = (name, ...yes) => ({ name, perms: Object.fromEntries(PERMS.map((p) => [p, yes.includes(p)])) });
  async function newGroup() {
    if ((groupIndex || []).length >= GROUP_MAX) return banner(`An account can be in up to ${GROUP_MAX} groups.`);
    const name = await askNbName("New group", "Create", "", groupIndex || [], "Group name", "Study group");
    if (!name) return;
    const id = "g" + rid() + rid(), at = platform.group(id), now = new Date().toISOString();
    try {
      await platform.together([[at.info, { name, owner: uid, link: null, createdAt: now }], [at.db.doc("members/" + uid), { name: memberName(), role: "owner", joinedAt: now, via: "" }],
        [at.db.doc("roles/member"), role("Member")], [at.db.doc("roles/editor"), role("Editor", "edit")]]);
    } catch { return banner("Couldn't make the group. Try again."); }
    await saveGroups([...(groupIndex || []), { id, name }]);
  }

  // A group's notebooks: a line under notebooks/<id> ({ name, at }) for each, beside its documents.
  async function newGroupNb(id) {
    const g = groups.get(id);
    const name = g && (await askNbName(`New notebook in “${groupName(g)}”`, "Create", "", g.notebooks));
    if (!name) return;
    const n = { id: "n" + rid(), name, at: new Date().toISOString() };
    if (!(await saveGroupNb(g, n, name))) return;
    if (!g.notebooks.some((x) => x.id === n.id)) g.notebooks = [...g.notebooks, n]; // there before the database's answer
    openNotebook(`${id}/${n.id}`);
  }
  nbActs.groupNb = newGroupNb;
  async function saveGroupNb(g, n, name) {
    try { await platform.group(g.id).db.doc("notebooks/" + n.id).set({ name, at: n.at || new Date().toISOString() }); return true; }
    catch { banner("Couldn't save that. Try again."); return false; }
  }
  async function dropGroupNb(g, n) {
    try { await platform.group(g.id).db.doc("notebooks/" + n.id).delete(); return true; } catch { banner("Couldn't delete that notebook. Try again."); return false; }
  }

  // Move to a group: one of the account's own notebooks goes into a group (copied there, then deleted here), with its choices.
  async function moveToGroup() {
    const n = nbNow(), places = [...groups.values()].filter((g) => groupReady(g) && perm(g, "notebooks"));
    if (n.share) return banner("Stop sharing this notebook first. A group's notebooks are shared with the group instead.");
    if (n.from) return banner("This notebook gets its owner's changes. To move it, keep it as your own copy first.");
    const answer = ask(`Move “${n.name}” to a group?`, `<p>Everyone in the group can see it there, and whoever may edit the group's notebooks can change it. It leaves your own notebooks.</p>
      ${places.map((g, i) => `<label class="checkrow"><input type="radio" name="moveTo" value="${esc(g.id)}"${i ? "" : " checked"}> ${esc(groupName(g))}</label>`).join("")}`, "Move");
    if (!(await answer)) return;
    const g = groups.get($("#askText input[name=moveTo]:checked")?.value), to = { id: "n" + rid(), name: nbFree(n.name, "", g.notebooks), at: new Date().toISOString() };
    const into = inNotebook(platform.group(g.id).db, to.id), v = vocabNow(), now = new Date().toISOString();
    try {
      for (const { id, ...d } of v.sets) await into.doc("sets/" + id).set({ ...d, updatedAt: now });
      for (const { id, ...d } of v.kanji) await into.doc("kanji/" + id).set({ ...d, updatedAt: now });
      for (const [p, d] of [["meta/books", v.collections], ["meta/views", v.views], ["meta/courses", v.courses]]) if (d) await into.doc(p).set(d);
      if (!(await saveGroupNb(g, to, to.name))) return;
    } catch { return banner("Couldn't move that notebook. Try again."); }
    if (!g.notebooks.some((x) => x.id === to.id)) g.notebooks = [...g.notebooks, to];
    const id = `${g.id}/${to.id}`;
    setPicks(id, picksOf(n.id));
    openNotebook(id);
    // Then it's taken out of the account (if that fails, it's in both: nothing is lost).
    try { await emptyNotebook(n.id); } catch { return banner("It's in the group now, but some of it is still in your notebooks too. Delete it there if you like."); }
    const rest = nbList().filter((x) => x.id !== n.id);
    if (await saveNotebooks(rest.length ? rest : [{ id: MAIN_NB, name: NB_NAME }])) setPicks(n.id, null);
  }
  nbMore.push({ key: "moveToGroup", label: () => "Move to a group", icon: "M4 12 H15 M11 8 L15 12 L11 16 M19 5 V19",
    run: moveToGroup, when: () => !nbNow()?.group && [...groups.values()].some((g) => groupReady(g) && perm(g, "notebooks")) });
  nbMore.push({ key: "newGroup", label: () => "New group", icon: "M16 19 v-1.5 a3.5 3.5 0 0 0 -3.5 -3.5 h-5 A3.5 3.5 0 0 0 4 17.5 V19 M10 10.5 a3 3 0 1 0 0 -6 a3 3 0 0 0 0 6 M20 19 v-1.5 a3.5 3.5 0 0 0 -2.5 -3.35 M15 4.6 a3 3 0 0 1 0 5.8",
    run: newGroup, when: () => !!account });

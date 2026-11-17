  // ---------- a group's settings (public site) ----------
  // The gear by a group's name in the notebook menu opens them, for everyone in it: their own name in the group, who's in
  // it, and leaving it. Manage members gives people roles and takes them out; Manage roles makes roles and picks what each
  // may do; the owner also renames the group, hands it to someone in it or deletes it. Nobody can give a role with a
  // permission they don't have themselves: this offers only what firestore.rules allows.
  const PERM_NAMES = { edit: "Edit notebooks", notebooks: "Manage notebooks", share: "Share by link", invite: "Invite", approve: "Approve requests", members: "Manage members", roles: "Manage roles" };
  const permsOf = (g, r) => (r === "owner" ? Object.fromEntries(PERMS.map((p) => [p, true])) : g.roles.get(r)?.perms || {});
  const permCount = (g, r) => PERMS.filter((p) => permsOf(g, r)[p]).length;
  // Whether this account could give role r: it isn't the owner's, and every permission in it is one of this account's own.
  const canGive = (g, r) => r !== "owner" && g.roles.has(r) && PERMS.every((p) => !permsOf(g, r)[p] || perm(g, p));
  const roleName = (g, r) => (r === "owner" ? "Owner" : tidy(g.roles.get(r)?.name, 40) || "No role");
  const rolesInOrder = (g) => [...g.roles.keys()].sort((a, b) => permCount(g, a) - permCount(g, b) || coll.compare(roleName(g, a), roleName(g, b)));
  // The people in a group: its owner first, then in the order they joined.
  const readMembers = async (id) => (await platform.group(id).db.collection("members").get()).docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.role === "owner") - (a.role === "owner") || String(a.joinedAt).localeCompare(String(b.joinedAt)));

  // view: "" for all of it, "role:<id>" for one role's name and permissions.
  async function groupSettings(id, view = "") {
    const g = groups.get(id);
    if (!groupReady(g)) return;
    let people;
    try { people = await readMembers(id); } catch { return banner("Couldn't open the group's settings. Try again."); }
    // Something that asks first (or has a pop-up of its own) closes these and runs after.
    let then = null;
    const later = (f) => () => { then = f; $("#askDlg").close("no"); };
    const closed = ask(groupName(g), `<div class="gset" id="gsBody"></div>`, "Done"), at = platform.group(id);
    const q = (s) => $("#gsBody").querySelector(s), each = (s, f) => $("#gsBody").querySelectorAll(s).forEach(f);
    const saving = async (f) => { try { await f(); return true; } catch { q("#gsErr").hidden = false; return false; } };
    const used = (r) => people.some((m) => m.role === r) || g.info.link?.role === r;
    function draw() {
      const owner = g.me.role === "owner", r = view.slice(5), x = g.roles.get(r);
      $("#gsBody").innerHTML = (view ? `<section><h4>Role</h4><input class="tsearch" id="gsRoleName" maxlength="40" aria-label="Role name" value="${esc(roleName(g, r))}">
        <div class="gsperms">${PERMS.map((p) => `<label class="checkrow"><input type="checkbox" data-perm="${p}"${x?.perms?.[p] ? " checked" : ""}${perm(g, p) ? "" : " disabled"}> ${PERM_NAMES[p]}</label>`).join("")}</div>
        <p class="tactions"><button class="btn primary" type="button" id="gsRoleSave">Save role</button><button class="btn" type="button" id="gsBack">Back</button>
        ${used(r) ? "" : `<button class="link danger" type="button" id="gsRoleDel">Delete role</button>`}</p>${used(r) ? `<p class="small muted">Someone has this role${g.info.link?.role === r ? ", or the join link gives it" : ""}, so it can't be deleted.</p>` : ""}</section>`
      : `<section><h4>Your name in this group</h4><div class="gsrow"><input class="tsearch" id="gsName" maxlength="60" aria-label="Your name in this group" value="${esc(g.me.name || "")}"><button class="btn" type="button" id="gsNameSave">Save</button></div></section>
        <section><h4>People (${people.length})</h4><ul class="gslist">${people.map((m) => `<li><span class="gsn">${esc(m.name)}${m.id === uid ? ` <span class="muted">(you)</span>` : ""}</span>
          ${m.id !== uid && perm(g, "members") && canGive(g, m.role) ? `<span class="gsrole" data-role-of="${esc(m.id)}"></span><button class="link danger" type="button" data-out="${esc(m.id)}">Remove</button>`
            : `<span class="small muted">${esc(roleName(g, m.role))}</span>`}</li>`).join("")}</ul></section>
        ${perm(g, "roles") ? `<section><h4>Roles</h4><ul class="gslist">${rolesInOrder(g).map((r) => `<li><span class="gsn">${esc(roleName(g, r))}
          <span class="small muted">${esc(PERMS.filter((p) => permsOf(g, r)[p]).map((p) => PERM_NAMES[p]).join(", ") || "Can look and practice")}</span></span>
          ${canGive(g, r) ? `<button class="link" type="button" data-role-edit="${esc(r)}">Change</button>` : ""}</li>`).join("")}</ul>
          <button class="link" type="button" id="gsNewRole">New role</button></section>` : ""}
        <section><h4>The group</h4>${owner ? `<div class="gsrow"><input class="tsearch" id="gsGroupName" maxlength="60" aria-label="Group name" value="${esc(groupName(g))}"><button class="btn" type="button" id="gsGroupSave">Rename</button></div>
          ${people.length > 1 ? `<div class="gsrow"><span id="gsTo"></span><button class="btn" type="button" id="gsHand">Hand over</button></div>` : ""}
          <button class="link danger" type="button" id="gsDelete">Delete this group</button>` : `<button class="link danger" type="button" id="gsLeave">Leave this group</button>`}</section>`)
        + `<p class="keyerr small" id="gsErr" hidden>Couldn't save that. Try again.</p>`;
      if (view) {
        q("#gsBack").onclick = () => { view = ""; draw(); };
        q("#gsRoleSave").onclick = async () => {
          const v = { name: tidy(q("#gsRoleName").value, 40) || roleName(g, r), perms: Object.fromEntries(PERMS.map((p) => [p, q(`[data-perm="${p}"]`).checked])) };
          if (await saving(() => at.db.doc("roles/" + r).set(v))) { g.roles.set(r, v); view = ""; draw(); }
        };
        if (q("#gsRoleDel")) q("#gsRoleDel").onclick = async () => { if (await saving(() => at.db.doc("roles/" + r).delete())) { g.roles.delete(r); view = ""; draw(); } };
        return;
      }
      q("#gsNameSave").onclick = async () => { const name = tidy(q("#gsName").value, 60); if (name && (await saving(() => at.db.doc("members/" + uid).update({ name })))) { g.me = { ...g.me, name }; people.find((m) => m.id === uid).name = name; draw(); } };
      each("[data-role-of]", (box) => {
        const m = people.find((p) => p.id === box.dataset.roleOf);
        makeDropdown(box, `Role of ${m.name}`, rolesInOrder(g).filter((r) => canGive(g, r)).map((r) => [r, roleName(g, r)]), async (r) => { if (await saving(() => at.db.doc("members/" + m.id).update({ role: r }))) m.role = r; draw(); }).set(m.role);
      });
      each("[data-out]", (b) => (b.onclick = later(async () => {
        const m = people.find((p) => p.id === b.dataset.out);
        if (await ask(`Take ${m.name} out of “${groupName(g)}”?`, `<p>They can't open its notebooks any more. What they practised stays in their own account.</p>`, "Remove", true))
          await at.db.doc("members/" + m.id).delete().catch(() => banner("Couldn't do that. Try again."));
        groupSettings(id);
      })));
      each("[data-role-edit]", (b) => (b.onclick = () => { view = "role:" + b.dataset.roleEdit; draw(); }));
      if (q("#gsNewRole")) q("#gsNewRole").onclick = later(async () => {
        const name = await askNbName("New role", "Create", "", [...g.roles.values()], "Role name", "Helper", 36), r = "r" + rid();
        if (name) try { await at.db.doc("roles/" + r).set(role(name)); g.roles.set(r, role(name)); } catch { banner("Couldn't make that role. Try again."); }
        groupSettings(id, name && g.roles.has(r) ? "role:" + r : "");
      });
      if (!owner) return void (q("#gsLeave").onclick = later(() => leaveGroup(g)));
      q("#gsGroupSave").onclick = async () => { const name = tidy(q("#gsGroupName").value, 60); if (name && name !== groupName(g) && (await saving(() => at.info.update({ name })))) $("#askTitle").textContent = name; };
      if (q("#gsTo")) {
        const others = people.filter((m) => m.id !== uid);
        let to = others[0];
        makeDropdown(q("#gsTo"), "Hand over to", others.map((m) => [m.id, m.name]), (v) => (to = others.find((m) => m.id === v))).set(to.id);
        q("#gsHand").onclick = later(() => handOver(g, to));
      }
      q("#gsDelete").onclick = later(() => deleteGroup(g));
    }
    draw();
    await closed;
    if (then) await then();
  }
  nbActs.groupSettings = groupSettings;

  // The group goes to someone in it (to: their member line, with its id), and this account takes the role they had: all in
  // one write, as firestore.rules wants it.
  function handTo(g, info, me, to) {
    const at = platform.group(g.id), { id, ...line } = to;
    return platform.together([[at.info, { ...info, owner: id }], [at.db.doc("members/" + id), { ...line, role: "owner" }], [at.db.doc("members/" + uid), { ...me, role: to.role }]]);
  }
  async function handOver(g, to) {
    if (!(await ask(`Hand “${groupName(g)}” over to ${to.name}?`, `<p>${esc(to.name)} becomes its owner, and you take the role they had (${esc(roleName(g, to.role))}). Only the owner can hand it back.</p>`, "Hand over", true))) return groupSettings(g.id);
    try { await handTo(g, g.info, g.me, to); } catch { banner("Couldn't hand it over. Try again."); }
  }
  // Leaving, or deleting the group: its notebook, if one is open, is closed first (the first of the account's own opens).
  const closeGroupNb = (g) => { if (splitNb(nb)?.g === g.id) openNotebook(nbList()[0].id); };
  async function leaveGroup(g) {
    if (!(await ask(`Leave “${groupName(g)}”?`, `<p>Its notebooks leave your list. What you practised stays in your account. To come back, you'd need to be invited again.</p>`, "Leave", true))) return groupSettings(g.id);
    closeGroupNb(g); stopGroup(g.id);
    try { await platform.group(g.id).db.doc("members/" + uid).delete(); } catch { banner("Couldn't leave the group. Try again."); return syncGroups(); }
    await saveGroups(groupIndex.filter((x) => x.id !== g.id));
  }
  async function deleteGroup(g) {
    if (!(await ask(`Delete “${groupName(g)}”?`, `<p>${!g.notebooks.length ? "It has no notebooks." : `${g.notebooks.length > 1 ? `Its ${g.notebooks.length} notebooks and everything in them are` : "Its notebook and everything in it is"} deleted for good, for everyone in it. Export what you want to keep first.`}</p>`, "Delete group", true))) return groupSettings(g.id);
    closeGroupNb(g); stopGroup(g.id);
    try { await emptyGroup(g.id); } catch { banner("Couldn't delete all of the group. Try again."); return syncGroups(); }
    await saveGroups(groupIndex.filter((x) => x.id !== g.id));
  }
  // Everything in a group, deleted in the order the rules allow: its notebooks, roles and requests, then everyone in it
  // (its owner last), its join link's page, and the group.
  async function emptyGroup(id) {
    const at = platform.group(id), info = dataOrNull(await at.info.get()), list = async (c) => (await at.db.collection(c).get()).docs.map((d) => d.id);
    for (const n of await list("notebooks")) { await emptyVocab(inNotebook(at.db, n)); await at.db.doc("notebooks/" + n).delete(); }
    for (const c of ["roles", "requests"]) for (const d of await list(c)) await at.db.doc(`${c}/${d}`).delete();
    for (const u of (await list("members")).filter((u) => u !== uid)) await at.db.doc("members/" + u).delete();
    for (const end of groupGone) await end(id, info);
    await at.db.doc("members/" + uid).delete();
    await at.info.delete();
  }

  // Delete my account (account/account.js) waits while this account owns a group: it's handed over or deleted first.
  function groupsBlockDelete() {
    if (!groupIndex || [...groups.values()].some((g) => !groupReady(g))) return "Your groups are still loading. Try again in a moment.";
    const own = [...groups.values()].filter((g) => g.me.role === "owner").map((g) => `“${groupName(g)}”`);
    return own.length ? `You own ${own.length > 1 ? own.slice(0, -1).join(", ") + " and " + own.at(-1) : own[0]}. Hand ${own.length > 1 ? "each" : "it"} over to someone in it, or delete it, from its settings in the notebook menu first.` : "";
  }
  // Deleting the account leaves every group it's in. When the site closes the account (forced: an under-13 birthday), each
  // group it owns goes to whoever has been in it longest of those whose role has the most permissions, or is deleted if
  // nobody else is in it.
  async function leaveGroups(forced) {
    for (const id of [...groups.keys()]) stopGroup(id);
    for (const { id } of groupIndex || []) {
      const at = platform.group(id), line = await at.db.doc("members/" + uid).get().catch(() => null), me = line?.exists ? line.data() : null;
      if (!me) continue;
      if (me.role !== "owner") { await at.db.doc("members/" + uid).delete(); continue; }
      if (!forced) continue; // (Settings doesn't start deleting while it owns one)
      const g = { id, roles: new Map((await at.db.collection("roles").get()).docs.map((d) => [d.id, d.data()])) }, people = (await readMembers(id)).filter((m) => m.id !== uid);
      const heir = people.sort((a, b) => permCount(g, b.role) - permCount(g, a.role) || String(a.joinedAt).localeCompare(String(b.joinedAt)))[0];
      if (!heir) { await emptyGroup(id); continue; }
      await handTo(g, dataOrNull(await at.info.get()), me, heir);
      await at.db.doc("members/" + uid).delete();
    }
  }

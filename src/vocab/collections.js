  // ---------- editing collections ----------
  // "Edit collections" turns the top of the vocab table into an editor for every view at once (vocab/views.js); nothing
  // is stored until Save. While it's open, S.colEdit is
  //   { at, mainName, main: [col], others: [{ name, was, cols: [col] }], units: { [id]: { name, srcs } }, was }
  // with col = { id, name, units: [unit id], was }: at is the view being edited (-1 for the main one), a view's or col's was
  // is its name when editing began (null for one added, or for the main view turned into another), a unit's id is the
  // unitKey() it had when editing began, and srcs are the unitKey()s it stands for (more than one once two are merged).
  // In the main view, moving a unit moves its sets and kanji list into that collection, and a unit of the same name there
  // merges with it (after asking). In another view, moving a unit only regroups it. Units sort by name in a collection.
  const colSnap = (e) => JSON.stringify([e.mainName, e.main, e.others, e.units]);
  const colsDirty = () => !!S.colEdit && colSnap(S.colEdit) !== S.colEdit.was;
  const newCol = (name, units) => ({ id: rid(), name, units, was: name });
  $("#editColBtn").onclick = () => {
    const units = {}, keys = new Set(allUnits());
    for (const k of keys) units[k] = { name: keyUnit(k), srcs: [k] };
    // A unit is in at most one collection of a view: the first that has it.
    const once = (list) => { const used = new Set(); return list.map((c) => newCol(c.name, c.units.filter((u) => keys.has(u) && !used.has(u) && used.add(u)))); };
    S.colEdit = { at: -1, mainName: mainName(), main: cols().map((b) => newCol(b, tKeys(b))), others: altViews().map((v) => ({ name: v.name, was: v.name, cols: once(v.collections) })), units };
    S.colEdit.was = colSnap(S.colEdit);
    clearSearch(); renderTable();
    $("#colDiscard").focus();
  };
  $("#colDiscard").onclick = () => { S.colEdit = null; renderTable(); $("#editColBtn").focus(); };
  $("#colSave").onclick = async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = "Saving…";
    const ok = await saveCols((m) => { $("#colErr").textContent = m; });
    b.textContent = "Save";
    if (ok) renderTable(); else b.disabled = false;
  };
  const viewCols = (e) => (e.at < 0 ? e.main : e.others[e.at].cols);
  // Which main-view collection each unit is in, by its position: other views list units in that order.
  const mainAt = (e) => { const m = {}; e.main.forEach((c, i) => c.units.forEach((u) => (m[u] = i))); return m; };

  // The top of the table while editing: the views to pick from, under the search, then the picked view's collections.
  function renderColEdit() {
    const e = S.colEdit, vEd = $("#viewEd"), cEd = $("#colEd");
    vEd.hidden = cEd.hidden = !e;
    if (!e) { vEd.innerHTML = cEd.innerHTML = ""; return; }
    const chip = (i, name) => `<button type="button" class="chip" data-view="${i}" aria-pressed="${e.at === i}">${esc(name.replace("\n", " ") || "Untitled view")}</button>`;
    vEd.innerHTML = `<div class="chips" role="group" aria-label="Views">${chip(-1, e.mainName)}<span class="mainptr small">← main view${qtip("mainTip", "What the main view is", "Your sets are saved in the main view's collections. Other views group the same units another way without changing them, and any of them can become the main view.")}</span>
        ${e.others.map((v, i) => chip(i, v.name)).join("")}<button type="button" class="chip add" data-vadd>+ New view</button></div>
      <div class="viewbar"><label class="small">View name <input type="text" data-vname maxlength="60" value="${esc(e.at < 0 ? e.mainName : e.others[e.at].name.replace("\n", " "))}"></label>
        ${e.at >= 0 ? `<button class="link" type="button" data-vmain>Make this the main view</button><button class="link danger" type="button" data-vdel>Delete view</button>` : `<span class="muted small">Moving a unit here moves its sets to that collection.</span>`}</div>`;
    const list = viewCols(e), at = mainAt(e), main = e.at < 0;
    const sorted = (ids) => ids.slice().sort((a, b) => (main ? 0 : (at[a] ?? 1e9) - (at[b] ?? 1e9)) || byUnit(e.units[a].name, e.units[b].name));
    const inOther = main ? [] : Object.keys(e.units).filter((u) => !list.some((c) => c.units.includes(u)));
    const chips = (ids, where) => {
      const list = sorted(ids), colName = (u) => e.main[at[u]]?.name ?? "", tags = main ? [] : fromTags(list, colName);
      return list.map((u, i) => `${tags[i] || ""}<button type="button" class="chip unit" data-u="${esc(u)}" aria-label="${esc(e.units[u].name)}${main ? "" : ` (${esc(colName(u))})`} in ${esc(where)}. Drag it, or press the up or down arrow to move it to the collection above or below.">${esc(e.units[u].name)}</button>`).join("")
        || `<span class="muted small">Drag units here</span>`;
    };
    cEd.innerHTML = list.map((c, i) => `<div class="colrow" data-col="${c.id}">
        <span class="colctl"><button class="grip" type="button" aria-label="Drag to move ${esc(c.name || "this collection")}" title="Drag to move">⠿</button><button class="ghost" type="button" data-cmove="-1" aria-label="Move ${esc(c.name || "this collection")} up"${i ? "" : " disabled"}>↑</button><button class="ghost" type="button" data-cmove="1" aria-label="Move ${esc(c.name || "this collection")} down"${i < list.length - 1 ? "" : " disabled"}>↓</button></span>
        <textarea class="colname" rows="${c.name.includes("\n") ? 2 : 1}" data-cname maxlength="100" placeholder="Collection name" aria-label="Name of collection ${i + 1}">${esc(c.name)}</textarea>
        <div class="colunits" data-drop="${c.id}">${chips(c.units, c.name)}</div>
        <button class="ghost small" type="button" data-cdel${main && c.units.length ? ` disabled title="Move its units to other collections first"` : ""}>Delete</button></div>`).join("")
      + (main ? "" : `<div class="colrow other" data-col="other"><span class="colctl"></span><span class="colname">Other</span><div class="colunits" data-drop="other">${chips(inOther, "Other")}</div><span></span></div>`)
      + `<div class="row"><button class="btn" type="button" data-cadd>+ Add collection</button><span class="muted small">${main ? "" : "Units in no collection of this view show under “Other”."}${main ? "" : " Press Enter in a name to put it on two lines."}</span></div>`;
    syncColBtns(); tipTaps(vEd);
    const redo = (focus) => { renderColEdit(); renderLeave(); if (focus) document.querySelector(focus)?.focus(); };
    vEd.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { e.at = +b.dataset.view; redo(`#viewEd [data-view="${e.at}"]`); }));
    vEd.querySelector("[data-vname]").addEventListener("input", (ev) => {
      const v = tidy(ev.target.value, 60);
      if (e.at < 0) e.mainName = v; else e.others[e.at].name = v;
      vEd.querySelector(`[data-view="${e.at}"]`).textContent = v || "Untitled view"; syncColBtns();
    });
    vEd.querySelector("[data-vadd]").onclick = () => {
      e.others.push({ name: freeName("New view", [e.mainName, ...e.others.map((v) => v.name)]), was: null, cols: e.main.map((c) => newCol(c.name, [...c.units])) });
      e.at = e.others.length - 1; redo(); const n = vEd.querySelector("[data-vname]"); n.focus(); n.select();
    };
    const vdel = vEd.querySelector("[data-vdel]");
    if (vdel) vdel.onclick = async () => {
      const v = e.others[e.at];
      if (!(await ask("Delete this view?", `<p>The view <b>${esc(v.name)}</b> and the way it groups the units go. Your sets, units and other views stay as they are.</p><p>Nothing is changed until you press Save.</p>`, "Delete view"))) return;
      e.others.splice(e.at, 1); e.at = -1; redo(`#viewEd [data-view="-1"]`);
    };
    const vmain = vEd.querySelector("[data-vmain]");
    if (vmain) vmain.onclick = () => makeMain(e.at);
    cEd.querySelectorAll(".colrow:not(.other)").forEach((row, i) => {
      const c = list[i], nm = row.querySelector("[data-cname]");
      nm.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (main || nm.value.includes("\n"))) ev.preventDefault(); });
      nm.addEventListener("input", () => { c.name = main ? tidy(nm.value, 100) : nm.value; nm.rows = nm.value.includes("\n") ? 2 : 1; syncColBtns(); renderLeave(); });
      row.querySelectorAll("[data-cmove]").forEach((b) => (b.onclick = () => { const d = +b.dataset.cmove; list.splice(i + d, 0, ...list.splice(i, 1)); redo(`[data-col="${c.id}"] [data-cmove="${d}"]:not(:disabled)`); }));
      row.querySelector("[data-cdel]").onclick = () => { list.splice(i, 1); redo(`#colEd [data-cadd]`); };
    });
    cEd.querySelector("[data-cadd]").onclick = () => { const c = newCol("", []); list.push(c); redo(`[data-col="${c.id}"] [data-cname]`); };
    // The arrow keys move a unit to the collection above or below (in another view, "Other" is the last).
    cEd.querySelectorAll(".chip.unit").forEach((b) => b.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
      ev.preventDefault();
      const rows = [...cEd.querySelectorAll("[data-drop]")], i = rows.indexOf(b.closest("[data-drop]")) + (ev.key === "ArrowUp" ? -1 : 1);
      if (rows[i]) moveUnit(b.dataset.u, rows[i].dataset.drop);
    }));
  }
  const freeName = (base, taken) => { let n = base, k = 2; while (taken.some((t) => sameName(t, n))) n = `${base} ${k++}`; return n; };
  function syncColBtns() {
    const ch = colsDirty();
    $("#colSave").disabled = !ch; $("#colState").textContent = ch ? "Unsaved changes" : ""; $("#colErr").textContent = "";
  }

  // Dragging: a unit onto a collection's row, or a collection (by its ⠿) to another place in the list.
  const markDrop = (sel) => { $("#colEd").querySelectorAll(".dropon, .dropabove, .dropbelow").forEach((x) => x.classList.remove("dropon", "dropabove", "dropbelow")); if (sel) sel[0]?.classList.add(sel[1]); };
  const dropAt = (x, y) => document.elementFromPoint(x, y)?.closest("#colEd [data-drop]");
  makeDrag($("#colEd"), ".chip.unit", {
    over: (el, x, y) => { const t = dropAt(x, y); markDrop(t && t !== el.closest("[data-drop]") ? [t, "dropon"] : null); },
    drop: (el, x, y) => { const t = dropAt(x, y); if (t) moveUnit(el.dataset.u, t.dataset.drop); },
    end: () => markDrop(null),
  });
  // Where a collection dragged to height y would go: before the row whose middle is below y.
  const rowSlot = (y) => { const rows = [...$("#colEd").querySelectorAll(".colrow:not(.other)")]; const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; }); return { rows, i: i < 0 ? rows.length : i }; };
  makeDrag($("#colEd"), ".grip", {
    over: (el, x, y) => { const { rows, i } = rowSlot(y); markDrop(i < rows.length ? [rows[i], "dropabove"] : [rows[rows.length - 1], "dropbelow"]); },
    drop: (el, x, y) => {
      const list = viewCols(S.colEdit), from = list.findIndex((c) => c.id === el.closest(".colrow").dataset.col), { i } = rowSlot(y);
      const [c] = list.splice(from, 1); list.splice(i > from ? i - 1 : i, 0, c);
      renderColEdit(); renderLeave(); $(`[data-col="${c.id}"] .grip`)?.focus();
    },
    end: () => markDrop(null),
  });

  async function moveUnit(uid, to) {
    const e = S.colEdit, list = viewCols(e), from = list.find((c) => c.units.includes(uid)), target = list.find((c) => c.id === to);
    if ((from?.id ?? "other") === to) return;
    let keep = uid;
    if (e.at < 0) {
      if (!target) return;
      const u = e.units[uid], twin = target.units.find((x) => sameName(e.units[x].name, u.name));
      if (twin) {
        if (!(await ask("Merge these units?", `<p><b>${esc(target.name)}</b> already has a unit called <b>${esc(e.units[twin].name)}</b>. Moving <b>${esc(u.name)}</b> from <b>${esc(from.name)}</b> there makes them one unit: their sets go together, and their kanji lists become one.</p><p>Nothing is changed until you press Save.</p>`, "Merge them"))) return;
        mergeUnit(uid, twin); keep = twin;
      } else { from.units = from.units.filter((x) => x !== uid); target.units.push(uid); }
    } else {
      if (from) from.units = from.units.filter((x) => x !== uid);
      if (target) target.units.push(uid);
    }
    renderColEdit(); renderLeave();
    $("#colEd").querySelector(`[data-u="${CSS.escape(keep)}"]`)?.focus();
  }
  // uid joins into: their sets and kanji lists become one unit's, and each view keeps into where it had either.
  function mergeUnit(uid, into) {
    const e = S.colEdit;
    e.units[into].srcs.push(...e.units[uid].srcs); delete e.units[uid];
    for (const c of e.main) c.units = c.units.filter((x) => x !== uid);
    for (const v of e.others) {
      let has = v.cols.some((c) => c.units.includes(into));
      for (const c of v.cols) c.units = c.units.flatMap((x) => (x !== uid ? [x] : has ? [] : ((has = true), [into])));
    }
  }
  // Another view becomes the main one: each set moves to the collection its unit has there (units it has nowhere go into
  // a collection called Other), units of the same name in one collection merge, and the old main view stays as another view.
  async function makeMain(i) {
    const e = S.colEdit, v = e.others[i], placed = new Set(v.cols.flatMap((c) => c.units));
    const rest = Object.keys(e.units).filter((u) => !placed.has(u));
    const next = [...v.cols.map((c) => newCol(c.name.replace(/\s*\n\s*/g, " "), [...c.units])), ...(rest.length ? [newCol("Other", rest)] : [])];
    const merges = [];
    for (const c of next) { const by = new Map(); for (const u of c.units) { const k = e.units[u].name.toLowerCase(); if (by.has(k)) merges.push([u, by.get(k), c.name]); else by.set(k, u); } }
    const said = [...new Set(merges.map(([, into, col]) => `${e.units[into].name} in ${col}`))];
    const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
    if (!(await ask(`Make “${v.name.replace("\n", " ")}” the main view?`, `<p>Your sets will be saved in its collections: each set moves to the collection its unit has in <b>${esc(v.name)}</b>. <b>${esc(e.mainName)}</b> stays as another view, so you can switch back.</p>
      ${said.length ? `<p>Units with the same name in one collection become one unit, their sets together and their kanji lists combined: ${esc(said.join(", "))}.</p>` : ""}
      ${rest.length ? `<p>${n(rest.length, "unit")} in no collection of ${esc(v.name)} ${rest.length === 1 ? "goes" : "go"} into a collection called Other.</p>` : ""}<p>Nothing is changed until you press Save.</p>`, "Make it the main view"))) return;
    e.others.splice(i, 1, { name: e.mainName, was: null, cols: e.main.map((c) => newCol(c.name, [...c.units])) });
    e.mainName = v.name.replace(/\s*\n\s*/g, " "); e.main = next;
    for (const [u, into] of merges) mergeUnit(u, into);
    e.at = -1; renderColEdit(); renderLeave(); $(`#viewEd [data-view="-1"]`)?.focus();
  }

  // Stores what was edited: each set and kanji list that moved, the collection order, and the views. say shows what's
  // wrong; true = saved.
  async function saveCols(say) {
    const e = S.colEdit, now = new Date().toISOString(), showing = curView()?.name, twice = (xs) => xs.find((x, i) => xs.findIndex((y) => sameName(y, x)) !== i);
    const kept = e.main.filter((c) => c.units.length), colNames = kept.map((c) => tidy(c.name, 100));
    const vNames = [tidy(e.mainName, 60), ...e.others.map((v) => viewName(v.name, 60))];
    const bad = vNames.some((x) => !x) ? "Give every view a name." : twice(vNames) ? `Two views are called “${twice(vNames)}”.`
      : colNames.some((x) => !x) ? `Give every collection with units a name in ${vNames[0]}.` : twice(colNames) ? `Two collections in ${vNames[0]} are called “${twice(colNames)}”.`
      : e.others.map((v, i) => { const ns = v.cols.map((c) => viewName(c.name, 100)); return ns.some((x) => !x) ? `Give every collection a name in ${vNames[i + 1]}.` : twice(ns) ? `Two collections in ${vNames[i + 1]} are called “${twice(ns).replace("\n", " ")}”.` : ""; }).find(Boolean) || "";
    if (bad) { say(bad); return false; }
    // Where each unit ends up, and the documents that change to get it there.
    const to = {}, jobs = [];
    kept.forEach((c, i) => c.units.forEach((u) => (to[u] = { collection: colNames[i], unit: e.units[u].name })));
    for (const [u, { srcs }] of Object.entries(e.units)) {
      const t = to[u], has = new Set(srcs);
      if (!t) continue;
      // The sets already there keep their names; one that would share a name with another gets (2), (3)…
      const sets = S.sets.filter((s) => has.has(unitKey(s))).sort((a, b) => (unitKey(b) === srcs[0]) - (unitKey(a) === srcs[0])), taken = new Set();
      for (const s of sets) {
        let name = s.name, k = 2;
        while (taken.has(name.toLowerCase())) name = `${s.name} (${k++})`;
        taken.add(name.toLowerCase());
        if (colOf(s) !== t.collection || s.unit !== t.unit || name !== s.name) jobs.push(["update", "sets/" + s.id, { collection: t.collection, unit: t.unit, ...(name !== s.name ? { name } : {}), updatedAt: now }]);
      }
      const [k1, ...more] = S.kanjiLists.filter((k) => has.has(unitKey(k)));
      if (k1 && (more.length || colOf(k1) !== t.collection || k1.unit !== t.unit)) jobs.push(["update", "kanji/" + k1.id, { collection: t.collection, unit: t.unit, kanji: onlyKanji([k1, ...more].map((k) => k.kanji).join("")), updatedAt: now }]);
      for (const k of more) jobs.push(["delete", "kanji/" + k.id]);
    }
    if (JSON.stringify(colNames) !== JSON.stringify(cols())) jobs.push(["set", "meta/books", { order: colNames, updatedAt: now }]);
    const doc = { main: vNames[0], views: e.others.map((v, i) => ({ name: vNames[i + 1], collections: v.cols.map((c) => ({ name: viewName(c.name, 100), units: c.units.filter((u) => to[u]).map((u) => to[u]) })) })) };
    if (JSON.stringify(doc) !== JSON.stringify(S.viewDoc)) jobs.push(["set", "meta/views", { ...doc, updatedAt: now }]);
    let n = 0;
    try { for (const [how, path, d] of jobs) { await (how === "delete" ? db.doc(path).delete() : how === "set" ? db.doc(path).set(d) : db.doc(path).update(d)); n++; } }
    catch { say(n ? "Saving stopped partway. What was saved stays: reload the page and check, then try again." : "Couldn't save. Try again."); return false; }
    // What was picked follows its unit (and a renamed collection keeps its row's choice), here and on the practice page.
    const key = (t) => `${t.collection}\u0001${t.unit}`, moved = new Map(Object.entries(e.units).flatMap(([u, { srcs }]) => (to[u] ? srcs.map((s) => [s, key(to[u])]) : [])));
    const renamed = new Map(kept.filter((c, i) => c.was !== colNames[i]).map((c) => [c.was, tidy(c.name, 100)]));
    for (const p of [TP, PP]) { const st = p === TP ? S.tpick : S.pick; p.replace(Object.fromEntries(Object.entries(st.show || {}).map(([b, m]) => [renamed.get(b) ?? b, m])), new Set([...st.picks].map((k) => moved.get(k) ?? k))); }
    if (moved.has(S.upto)) { S.upto = moved.get(S.upto); store.set("uptoPick", S.upto); }
    // The unit rows stay on the view they showed, under its new name; on the main view if it became that or went.
    const stay = showing == null ? -1 : e.others.findIndex((v) => v.was === showing);
    S.groupBy = stay < 0 ? "main" : vNames[stay + 1]; store.set("groupBy", S.groupBy);
    S.viewDoc = cleanViews(doc); S.colEdit = null;
    return true;
  }

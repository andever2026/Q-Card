  // ---------- views ----------
  // A view is one way of putting every unit into rows, the collections. The main view is the one the sets are saved in
  // (each set's own collection and unit, in the collection order of meta/books). Other views group the same units another
  // way, such as by course: meta/views { main, views: [{ name, collections: [{ name, units: [{ collection, unit }] }] }] }
  // (vocab/docs.js). A unit no collection of a view has shows under "Other" there, so every view still has every unit.
  // Before views, courses took ranges of units (meta/courses): they're read as one view, "Courses" (courseView in
  // vocab/docs.js), until views are saved.
  // Every unit there is (with a set or a kanji list), as unitKey()s, in the main view's order.
  const allUnits = () => cols().flatMap(tKeys);
  const mainName = () => S.viewDoc?.main || "Books";
  // The other views, units as unitKey()s.
  function altViews() {
    const vs = S.viewDoc?.views ?? (S.courses.length ? [courseView(allUnits().map((k) => ({ collection: k.split("\u0001")[0], unit: keyUnit(k) })), S.courses)] : []);
    return vs.map((v) => ({ name: v.name, collections: v.collections.map((c) => ({ name: c.name, units: c.units.map(unitKey) })) }));
  }
  function onViews(snap) {
    raw.views = dataOrNull(snap);
    S.viewDoc = cleanViews(raw.views);
    renderSetup(); renderTable();
  }
  // The view the unit rows follow (S.groupBy names it), or null for the main view. Choices from before views: "course"
  // was the courses, "book" the main view.
  function curView() {
    const vs = altViews(), g = S.groupBy;
    return vs.find((v) => v.name === g) ?? (g === "course" ? vs[0] : null) ?? null;
  }
  // A view's rows among the keys given: each collection with the keys it has (once, in the first collection that has them),
  // then the rest under "Other". Collections with none of the keys are left out.
  function viewRows(v, keys) {
    const used = new Set();
    const rows = v.collections.map((c) => { const has = new Set(c.units); const ks = keys.filter((k) => has.has(k) && !used.has(k)); ks.forEach((k) => used.add(k)); return { name: c.name, keys: ks }; });
    const rest = keys.filter((k) => !used.has(k));
    return [...rows.filter((r) => r.keys.length), ...(rest.length ? [{ name: "Other", keys: rest }] : [])];
  }
  // Where a row of another view has two units of one name (Ch. 1 of two books), each names its collection. ids are in
  // order; colOf(id) and nameOf(id) are a unit's collection and name. Gives what goes inside each one's chip.
  const twinTags = (ids, colOf, nameOf) => { const low = (u) => nameOf(u).toLowerCase(), names = ids.map(low);
    return ids.map((u) => (names.filter((x) => x === low(u)).length > 1 ? `<span class="n">${esc(colLabel(colOf(u)))}</span>` : "")); };
  // The switch between views, on the practice page and in the vocab table: one button per view, or a dropdown once the
  // buttons would take more than half the width of the header they're in. Hidden while there's only the main view.
  function renderViewSwitch(box) {
    const vs = altViews(), on = curView()?.name ?? "";
    box.hidden = !vs.length;
    if (box.hidden) return;
    const opts = [["", mainName()], ...vs.map((v) => [v.name, v.name])];
    const pick = (v) => { S.groupBy = v || "main"; store.set("groupBy", S.groupBy); renderSetup(); renderTable(); };
    box.className = "seg mini viewsw";
    box.innerHTML = opts.map(([v, t]) => `<button type="button" data-view="${esc(v)}" aria-pressed="${v === on}">${esc(t.replace("\n", " "))}</button>`).join("");
    box.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => pick(b.dataset.view)));
    const head = box.closest(".head");
    if (head && box.scrollWidth > head.clientWidth / 2) { box.className = "viewsw"; makeDropdown(box, "View", opts.map(([v, t]) => [v, t.replace("\n", " ")]), pick).set(on); }
  }
  // Redrawn when its header changes width, so it turns into a dropdown (or back) as the window does.
  const viewSwitchFit = new ResizeObserver((es) => es.forEach((e) => { const w = Math.round(e.contentRect.width), box = e.target.querySelector(".viewsw");
    if (box && e.target.dataset.w !== String(w)) { e.target.dataset.w = w; renderViewSwitch(box); } }));
  for (const id of ["#groupSeg", "#tGroupSeg"]) viewSwitchFit.observe($(id).closest(".head"));

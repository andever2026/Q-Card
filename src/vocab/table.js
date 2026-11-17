  // ---------- vocab table ----------
  const onlyKanji = (raw) => [...new Set([...String(raw)].filter((c) => KANJI.test(c) && c !== "々"))].join("");
  function renderKanji() {
    $("#newKanjiForm").hidden = !canEdit();
    const box = $("#kanjiLists"), all = S.kanjiLists;
    // The lists for the units picked in the vocab table, or every list.
    const picked = all.filter((k) => TP.has(unitKey(k))), every = S.kAll || picked.length === all.length;
    const lists = all.filter((k) => every || TP.has(unitKey(k)) || dirtyList(k)), name = unitTitle;
    $("#kanjiCount").textContent = lists.length ? `${new Set(lists.flatMap((k) => [...(k.kanji || "")])).size} kanji` : "";
    $("#kSummary").textContent = !all.length ? "" : every && all.length > 1 ? `All ${all.length} kanji lists` : lists.length === 1 ? name(lists[0]) : lists.length ? `${lists.length} kanji lists` : "";
    $("#kAllBtn").hidden = !all.length || picked.length === all.length;
    $("#kAllBtn").textContent = S.kAll ? "Show only the units shown above" : "Show all units";
    if (!all.length) { box.innerHTML = `<div class="empty"><span>No kanji lists yet${canEdit() ? ". Add a unit below and paste its kanji." : "."}</span></div>`; return; }
    if (!lists.length) { box.innerHTML = `<div class="empty"><span>${TP.shownKeys().length ? "The units shown have no kanji lists" : "No units shown"}${canEdit() ? ". Add one below if a unit teaches kanji." : "."}</span></div>`; return; }
    // Like a set: the kanji read as text until Edit, which opens the collection, unit and kanji for editing; Save stores them.
    box.innerHTML = lists.map((k) => {
      const d = canEdit() ? S.kdrafts.get(k.id) : null, dirty = dirtyList(k), v = d ? d.kanji : k.kanji || "", del = S.kConfirmDel === k.id;
      const field = (f, label, more = "") => `<label>${label}<input id="kf-${esc(k.id)}-${f}" data-kf="${f}" value="${esc(d[f])}"${more}${d[f] !== (f === "collection" ? colOf(k) : k[f]) ? ` class="chg"` : ""}></label>`;
      return `<div class="tset open kset${d ? " editing" : ""}" data-kid="${esc(k.id)}">
        <h3 class="tseth"><span class="tsethead"><span class="t">${esc(name(k))}</span><span class="small">${dirty ? `<span class="dirty">Unsaved changes</span> · ` : d ? `<span class="muted">Editing · </span>` : ""}<span class="muted" data-kcount>${onlyKanji(v).length} kanji</span></span></span>${canEdit() && !d ? `<button class="btn" type="button" data-kedit>Edit</button>` : ""}</h3>
        ${d ? `<div class="newset setedit">${field("collection", "Collection", ` list="colList"`)}${field("unit", "Unit", ` list="unitList"`)}</div>
          <input type="text" class="kin${d.kanji !== (k.kanji || "") ? " chg" : ""}" id="k-${esc(k.id)}" data-kf="kanji" value="${esc(v)}" placeholder="Paste this unit's kanji" aria-label="Kanji for ${esc(name(k))}">
          <div class="tactions editbar"><button class="btn primary" data-ksave ${dirty ? "" : "disabled"}>Save</button><button class="btn" data-kdiscard>${dirty ? "Discard changes" : "Cancel"}</button><span class="editerr" data-kerr></span>
          <span style="flex:1"></span>${del ? `<span class="small">Delete this kanji list?</span><button class="btn danger" data-kdel-yes>Delete</button><button class="btn" data-kdel-no>Keep</button>` : `<button class="ghost small" data-kdel>Delete list</button>`}</div>`
        : `<p class="kro">${esc(v) || `<span class="muted small">No kanji yet.${canEdit() ? " Tap Edit to add some." : ""}</span>`}</p>`}
      </div>`;
    }).join("");
    if (!canEdit()) return;
    box.querySelectorAll("[data-kid]").forEach((row) => {
      const id = row.dataset.kid, k = lists.find((x) => x.id === id), d = S.kdrafts.get(id);
      const ke = row.querySelector("[data-kedit]");
      if (ke) ke.onclick = () => { S.kdrafts.set(id, { collection: colOf(k), unit: k.unit, kanji: k.kanji || "" }); renderKanji(); const f = document.getElementById(`k-${id}`); f?.focus(); };
      if (!d) return;
      const err = (m) => { row.querySelector("[data-kerr]").textContent = m; };
      const was = dirtyList(k);
      row.querySelectorAll("[data-kf]").forEach((inp) => inp.addEventListener("input", () => {
        const f = inp.dataset.kf; d[f] = inp.value; err("");
        inp.classList.toggle("chg", inp.value !== (f === "collection" ? colOf(k) : f === "unit" ? k.unit : k.kanji || ""));
        if (f === "kanji") row.querySelector("[data-kcount]").textContent = `${onlyKanji(inp.value).length} kanji`;
        if (dirtyList(k) !== was) renderTableKeepFocus(inp.id);
      }));
      row.querySelector("#k-" + CSS.escape(id)).addEventListener("keydown", (e) => { if (e.key === "Enter" && dirtyList(k)) row.querySelector("[data-ksave]").click(); });
      row.querySelector("[data-ksave]").onclick = async (ev) => {
        if (await whileSaving(ev.currentTarget, () => saveKanji(id, err))) renderTable();
      };
      row.querySelector("[data-kdiscard]").onclick = () => { S.kdrafts.delete(id); S.kConfirmDel = null; renderKanji(); };
      const d1 = row.querySelector("[data-kdel]"); if (d1) d1.onclick = () => { S.kConfirmDel = id; renderKanji(); };
      const dn = row.querySelector("[data-kdel-no]"); if (dn) dn.onclick = () => { S.kConfirmDel = null; renderKanji(); };
      const dy = row.querySelector("[data-kdel-yes]"); if (dy) dy.onclick = async () => { S.kConfirmDel = null; S.kdrafts.delete(id); try { await vdb.doc("kanji/" + id).delete(); } catch { banner("Couldn't delete that kanji list. Reload and try again."); } };
    });
  }
  $("#newKanjiForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const col = canonCol($("#nkCol").value), unit = canonUnit(col, $("#nkUnit").value); if (!unit || !col) return;
    pickUnit(unit, col); renderTable();
    if (S.kanjiLists.some((k) => sameName(colOf(k), col) && sameName(k.unit, unit))) { e.target.reset(); $("#nkCol").value = col; return; }
    const id = freeId(slug(`${col}-${unit}`, "kanji"), new Set(S.kanjiLists.map((k) => k.id)));
    try { await vdb.doc("kanji/" + id).set({ collection: col, unit, kanji: "", updatedAt: new Date().toISOString() }); e.target.reset(); $("#nkCol").value = col; }
    catch { banner("Couldn't add the kanji list. Only the owner and editors can change the table."); }
  });
  function onKanji(snap) {
    raw.kanji = withIds(snap);
    S.kLoaded = true;
    S.kanjiLists = snap.docs.map((d) => { const x = d.data(); return { id: d.id, collection: docCol(x), unit: docUnit(x), kanji: String(x.kanji ?? "") }; }).sort(sortLists);
    renderUpto(); renderTable(); renderSetup(); renderStats();
  }

  // A kanji list being edited (S.kdrafts: id -> { collection, unit, kanji }) with something different from what's stored.
  const dirtyList = (k) => { const d = S.kdrafts.get(k.id); return !!d && (d.kanji !== (k.kanji || "") || d.collection.trim() !== colOf(k) || d.unit.trim() !== k.unit); };
  // Stores an edited kanji list: its kanji, and its collection and unit if they changed. err shows what's wrong; true = saved.
  async function saveKanji(id, err = () => {}) {
    const k = S.kanjiLists.find((x) => x.id === id), d = S.kdrafts.get(id);
    if (!k || !d) return true;
    const col = canonCol(d.collection), unit = canonUnit(col, d.unit);
    if (!unit || !col) { err("Type a collection and a unit."); return false; }
    if (S.kanjiLists.some((x) => x.id !== id && sameName(colOf(x), col) && sameName(x.unit, unit))) { err(`${col} › ${unit} already has a kanji list.`); return false; }
    try { await vdb.doc("kanji/" + id).update({ collection: col, unit, kanji: onlyKanji(d.kanji), updatedAt: new Date().toISOString() }); }
    catch { err("Couldn't save. Try again."); return false; }
    if (S.upto === unitKey(k) && unitKey({ collection: col, unit }) !== S.upto) { S.upto = unitKey({ collection: col, unit }); store.set("uptoPick", S.upto); renderUpto(); }
    S.kdrafts.delete(id);
    if (col !== colOf(k) || unit !== k.unit) pickUnit(unit, col);
    return true;
  }
  // Units picked like on the practice page, sets folded until opened; a search looks across every unit.
  // Unit chips come from every unit used by a vocab set or a kanji list.
  const tKeys = (b) => [...new Set([...S.sets, ...S.kanjiLists].filter((x) => colOf(x) === b).map((x) => x.unit))].sort(byUnit).map((c) => `${b}\u0001${c}`);
  const TP = makePicker({ st: S.tpick, showKey: "tShow", chsKey: "tChs", cols, keys: tKeys, bar: $("#tPickBar"), rows: $("#tChs"),
    dot: (k) => (S.sets.some((s) => dirtySet(s) && unitKey(s) === k) ? `<span class="dot" title="Unsaved changes">•</span>` : ""),
    onChange: () => { clearSearch(); renderTable(); } });
  // The collection new sets and kanji lists default to: the first one with units showing.
  const curCol = () => TP.shownKeys()[0]?.split("\u0001")[0] ?? cols()[0] ?? "";
  $("#kAllBtn").onclick = () => { S.kAll = !S.kAll; renderKanji(); };
  const pickUnit = (unit, col) => TP.add(`${col}\u0001${unit}`);
  // Search keys are cached per word and rebuilt only when the word's text changes.
  const searunitKeys = new WeakMap();
  function wordKeys(w) {
    const src = `${w.en}\u0001${w.kana}\u0001${w.kanji}`;
    let k = searunitKeys.get(w);
    if (!k || k.src !== src) searunitKeys.set(w, (k = { src, en: String(w.en || "").toLowerCase(), kana: hira(w.kana), kanji: hira(w.kanji) }));
    return k;
  }
  function wordHit(w, q) {
    const k = wordKeys(w);
    return k.en.includes(q.en) || (!!q.jp && (k.kana.includes(q.jp) || k.kanji.includes(q.jp)));
  }
  const TLIMIT = 40; // matching rows drawn at once while searching
  function renderTableBar() {
    // Pages before v45 showed one book and one chapter (or All) at a time: start from that view, or the first unit.
    if (S.tpick.show == null) {
      const b0 = shownCol(S.tableBook), ks = tKeys(b0), c0 = S.tableCh == null ? null : String(S.tableCh), show = {};
      for (const b of cols()) show[b] = "none";
      const k = ks.find((x) => keyUnit(x) === oldUnit(c0)) ?? ks[0];
      if (c0 === "all") show[b0] = "all"; else if (k) show[b0] = "some";
      TP.replace(show, new Set(c0 !== "all" && k ? [k] : []));
    }
    const tp = S.tpick.picks, all = new Set(cols().flatMap(tKeys)), was = tp.size;
    for (const c of [...tp]) { const k = newKey(c, (x) => all.has(x)); if (k !== c) { tp.delete(c); tp.add(k); } }
    if (tp.size !== was || [...tp].some((k) => /\u0001\d+$/.test(k) && !all.has(k))) TP.replace(S.tpick.show, tp);
    // "Edit collections" (vocab/collections.js) puts its editor where the unit rows were, and Discard and Save where it was.
    const ed = !!S.colEdit;
    $("#editColBtn").hidden = !canEdit() || ed; $("#colBtns").hidden = !ed;
    $("#tTop").classList.toggle("editing", ed); $("#tPickBar").hidden = ed; $("#tSearch").disabled = ed;
    if (!ed) TP.render();
    syncGroupSegs(); renderColEdit();
  }
  // Search runs a moment after typing pauses, so each keystroke stays instant.
  let searchTimer = 0;
  function clearSearch() { clearTimeout(searchTimer); S.tq = ""; $("#tSearch").value = ""; S.touched.clear(); S.tAll = false; }
  $("#tSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value, run = () => { if (v === S.tq) return; S.tq = v; S.touched.clear(); S.tAll = false; renderTable(true); };
    v.trim() ? (searchTimer = setTimeout(run, 150)) : run();
  });
  $("#tOpenAll").onclick = () => {
    if (S.tq.trim()) { S.tAll = true; renderTable(true); return; }
    const ids = S.sets.filter((s) => TP.has(unitKey(s))).map((s) => s.id);
    const allOpen = ids.every((id) => S.openSets.has(id));
    for (const id of ids) allOpen ? S.openSets.delete(id) : S.openSets.add(id);
    renderTable();
  };

  // ---------- editing a set ----------
  // A set reads as plain text until Edit turns it into fields. While it's edited, S.drafts holds a copy of its words and
  // its details (collection, unit, name, tags), and nothing is stored until Save. Unsaved = the copy differs from what's stored.
  const setVals = (s) => ({ collection: colOf(s), unit: s.unit, name: s.name, tags: cleanTags(s.tags).join(", ") });
  const keptWords = (ws) => ws.map((w) => ({ id: w.id, en: (w.en || "").trim(), kana: (w.kana || "").trim(), kanji: (w.kanji || "").trim() })).filter((w) => w.en || w.kana || w.kanji);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const blankWord = () => ({ id: rid(), en: "", kana: "", kanji: "" });
  const startEdit = (s) => S.drafts.set(s.id, { words: s.words.length ? s.words.map((w) => ({ ...w })) : [blankWord()], vals: setVals(s) });
  function dirtySet(s) { const d = S.drafts.get(s.id); return !!d && !(same(keptWords(d.words), keptWords(s.words)) && same(d.vals, setVals(s))); }
  // Saves the set being edited: its words, and its details when they changed. say shows what's wrong; true = saved.
  async function saveSet(s, say) {
    const d = S.drafts.get(s.id), det = !same(d.vals, setVals(s));
    const col = canonCol(d.vals.collection), unit = canonUnit(col, d.vals.unit), name = tidy(d.vals.name, 200), tags = cleanTags(d.vals.tags);
    if (det && (!col || !unit || !name)) { say("Collection, unit and set name can't be empty."); return false; }
    if (det && S.sets.some((x) => x.id !== s.id && sameName(colOf(x), col) && sameName(x.unit, unit) && sameName(x.name, name))) { say(`${col} › ${unit} › ${name} already exists.`); return false; }
    try { await vdb.doc("sets/" + s.id).update({ ...(det ? { collection: col, unit, name, tags } : {}), words: keptWords(d.words).map((w) => ({ ...w, id: w.id || rid() })), updatedAt: new Date().toISOString() }); }
    catch { say("Couldn't save. Try again."); return false; }
    S.drafts.delete(s.id);
    if (det) { S.openSets.add(s.id); pickUnit(unit, col); }
    return true;
  }
  // A word's field grows with its text, so a long phrase wraps instead of scrolling sideways.
  const fit = CSS.supports("field-sizing", "content") ? () => {} : (t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; };
  // Unsaved changes are asked about before they can be lost: on leaving the vocab table, and by the browser on leaving the page.
  const unsavedSets = () => S.sets.filter(dirtySet), unsavedLists = () => S.kanjiLists.filter(dirtyList);
  addEventListener("beforeunload", (e) => { if (unsavedSets().length || unsavedLists().length || colsDirty()) { e.preventDefault(); e.returnValue = ""; } });
  // to: the view to go to (page/nav.js), or what to do (opening another notebook), once the changes are saved or let go.
  const leaveGo = () => (typeof S.leaveTo === "function" ? S.leaveTo() : openView(S.leaveTo));
  function leaveTable(to = "setup") {
    // Whatever was opened for editing and left as it was just closes.
    for (const s of S.sets) if (!dirtySet(s)) S.drafts.delete(s.id);
    for (const k of S.kanjiLists) if (!dirtyList(k)) S.kdrafts.delete(k.id);
    if (!colsDirty()) S.colEdit = null;
    S.confirmDel = S.kConfirmDel = null;
    S.leaveTo = to; S.leaveAsk = true; renderLeave();
    if (!S.leaveAsk) leaveGo(); else window.scrollTo(0, 0);
  }
  function renderLeave(why = "") {
    const sets = unsavedSets(), lists = unsavedLists(), crs = colsDirty(), n = sets.length + lists.length + crs, box = $("#leaveAsk");
    if (!n) S.leaveAsk = false;
    box.hidden = !S.leaveAsk;
    if (box.hidden) return;
    const count = (k, w) => (k ? [plural(k, w)] : []);
    box.innerHTML = `<span>${[...count(sets.length, "set"), ...count(lists.length, "kanji list"), ...(crs ? ["the collections"] : [])].join(" and ")} ${n === 1 && !crs ? "has" : "have"} unsaved changes.${why ? ` <span class="keyerr">${esc(why)}</span>` : ""}</span>
      <span class="tactions"><button class="btn primary" type="button" data-lsave>Save all</button><button class="btn" type="button" data-ldiscard>Discard all</button><button class="link" type="button" data-lkeep>Keep editing</button></span>`;
    box.querySelector("[data-lkeep]").onclick = () => { S.leaveAsk = false; renderLeave(); };
    box.querySelector("[data-ldiscard]").onclick = () => { S.drafts.clear(); S.kdrafts.clear(); S.colEdit = null; renderTable(); leaveGo(); };
    box.querySelector("[data-lsave]").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Saving…";
      let bad = "";
      for (const s of sets) if (!bad && !(await saveSet(s, (m) => { bad = `${setName(s)}: ${m}`; })) && !bad) bad = "Couldn't save. Try again.";
      for (const k of lists) if (!bad && !(await saveKanji(k.id))) bad = "Couldn't save. Try again.";
      if (crs && !bad && !(await saveCols((m) => { bad = `Collections: ${m}`; })) && !bad) bad = "Couldn't save. Try again.";
      renderTable();
      if (bad) renderLeave(bad); else leaveGo();
    };
  }

  function renderTable(searchOnly) {
    // The table is drawn again whenever anything changes, also from elsewhere: whoever is typing in it keeps their place.
    const at = document.activeElement, typing = at?.id && $("#setTables").contains(at) ? { id: at.id, pos: at.selectionStart } : null;
    if (!searchOnly) { renderKanji(); renderPort(); }
    renderLeave();
    $("#tableRole").hidden = canEdit();
    // While collections are edited, the sets and kanji lists below fold up under a grey cover: they can't be used until Save or Discard.
    const ed = !!S.colEdit;
    $("#newSetForm").hidden = !canEdit() || ed;
    for (const el of [$("#setTables"), $("#kanjiLists").closest(".panel")]) { el.inert = ed; el.classList.toggle("tlocked", ed); el.dataset.lock = "Editing collections"; }
    $("#colList").innerHTML = cols().filter(Boolean).map((b) => `<option value="${esc(b)}"></option>`).join("");
    // Prefill the Collection fields with the collection being viewed, keeping anything typed until the view moves to another one.
    if (S.formCol !== curCol()) { S.formCol = curCol(); for (const id of ["#nsCol", "#nkCol"]) $(id).value = S.formCol; }
    else for (const id of ["#nsCol", "#nkCol"]) if (!$(id).value && document.activeElement !== $(id)) $(id).value = S.formCol;
    $("#unitList").innerHTML = tKeys(S.formCol).map((k) => `<option value="${esc(keyUnit(k))}"></option>`).join("");
    const box = $("#setTables");
    const bar = $(".tbar"); bar.hidden = $("#tSum").hidden = !S.loaded || !S.sets.length;
    if (!S.loaded) { box.innerHTML = `<div class="empty">Loading…</div>`; return; }
    if (!S.sets.length) { box.innerHTML = `<div class="empty"><b>No sets yet.</b><span>${canEdit() ? "Add a set below, then fill in its words." : ""}</span></div>`; return; }
    renderTableBar();
    const q = S.tq.trim(), keys = TP.shownKeys(), allKeys = cols().flatMap(tKeys);
    // Each shown set: which rows (indexes into the full word list) to draw, and whether it is open.
    // While searching, only the first TLIMIT matches are drawn (edited and blank rows always are).
    const shown = [], qk = { en: q.toLowerCase(), jp: hira(q) };
    let total = 0, drawn = 0;
    let fresh = null;
    for (const s of S.sets) {
      // A set just added opens ready to type in.
      if (S.editNew === s.id) { S.editNew = null; if (canEdit() && !S.drafts.has(s.id)) { startEdit(s); fresh = s.id; } }
      const words = S.drafts.get(s.id)?.words || s.words;
      if (q) {
        const idx = []; let any = false;
        words.forEach((w, i) => {
          const hit = wordHit(w, qk);
          if (hit) total++;
          if (hit && (S.tAll || drawn < TLIMIT)) { drawn++; any = true; idx.push(i); }
          else if (S.touched.has(w.id) || !(w.en || w.kana || w.kanji)) idx.push(i);
        });
        if (any || S.drafts.has(s.id) && idx.length) shown.push({ s, words, idx, open: true });
      } else if (TP.has(unitKey(s))) {
        shown.push({ s, words, idx: words.map((w, i) => i), open: !ed && S.openSets.has(s.id) });
      }
    }
    const [b1, c1] = (keys[0] || "").split("\u0001");
    const where = keys.length === 1 ? `${multiCol() ? colLabel(b1) + " › " : ""}${c1}` : keys.length === allKeys.length ? (multiCol() ? "All collections" : "All units") : plural(keys.length, "unit");
    $("#tSummary").textContent = q
      ? (!total ? "" : drawn < total ? `Showing the first ${drawn} of ${total} matches. Keep typing to narrow it down.` : `${plural(total, "matching word")} in ${plural(shown.length, "set")}, ${multiCol() ? "all collections" : "all units"}`)
      : !keys.length ? "" : `${where}: ${plural(shown.length, "set")}, ${plural(shown.reduce((n, x) => n + readyCount(x.words), 0), "word")}`;
    const openAll = $("#tOpenAll"); openAll.hidden = ed || (q ? drawn >= total : !shown.length);
    openAll.textContent = q ? `Show all ${total}` : shown.every((x) => x.open) ? "Close all sets" : "Open all sets";
    if (q && !shown.length) { box.innerHTML = `<div class="empty"><b>No words match “${esc(q)}”.</b><span>Search looks at English, kana and kanji in every ${multiCol() ? "collection and unit" : "unit"}.</span></div>`; return; }
    if (!keys.length) { box.innerHTML = `<div class="empty"><span>${noUnitsShown}</span></div>`; return; }
    if (!shown.length) { box.innerHTML = `<div class="empty"><span>${esc(where)} ${keys.length === 1 ? "has" : "have"} no vocab sets yet${canEdit() ? ". Add one below." : "."}</span></div>`; return; }
    const manyCols = new Set(shown.map(({ s }) => colOf(s))).size > 1;
    box.innerHTML = shown.map(({ s, words, idx, open }) => {
      const d = canEdit() ? S.drafts.get(s.id) : null, dirty = dirtySet(s), was = new Map(s.words.map((w) => [w.id, w]));
      const head = `<h3 class="tseth"><button class="tsethead" type="button" data-toggle aria-expanded="${open}"><span class="t"><span class="car" aria-hidden="true">›</span>${esc(q || manyCols ? setName(s) : `${s.unit} › ${s.name}`)}${cleanTags(s.tags).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
        <span class="small">${dirty ? `<span class="dirty">Unsaved changes</span> · ` : d ? `<span class="muted">Editing · </span>` : ""}<span class="muted">${q ? `${idx.length} of ${plural(words.length, "word")}` : plural(readyCount(words), "word")}</span></span></button>${open && canEdit() && !d ? `<button class="btn" type="button" data-edit>Edit</button>` : ""}</h3>`;
      if (!open) return `<div class="tset" data-sid="${esc(s.id)}">${head}</div>`;
      const cell = (w, i, f, name) => `<textarea rows="1" id="w-${s.id}-${w.id}-${f}" data-i="${i}" data-f="${f}" placeholder="${name}" aria-label="${name}"${(w[f] || "").trim() !== (was.get(w.id)?.[f] || "").trim() ? ` class="chg"` : ""}>${esc(w[f])}</textarea>`;
      const rows = idx.map((i) => { const w = words[i]; return d
        ? `<tr><td>${cell(w, i, "en", "English")}</td><td class="jp">${cell(w, i, "kana", "Kana")}</td><td class="jp">${cell(w, i, "kanji", "Kanji")}</td>
             <td class="c"><button class="rowdel" data-del="${i}" aria-label="Delete row">×</button></td></tr>`
        : w.en || w.kana || w.kanji ? `<tr data-w="${esc(w.id)}"${ownWord(s, w) ? ` class="own"` : ""}><td data-f="en">${esc(w.en)}</td><td class="jp" data-f="kana">${esc(w.kana)}</td><td class="jp" data-f="kanji">${esc(w.kanji)}</td></tr>` : ""; }).join("");
      const del = S.confirmDel === s.id, now = setVals(s);
      const field = (f, name, more = "") => `<label>${name}<input id="d-${s.id}-${f}" data-ef="${f}" value="${esc(d.vals[f])}"${more}${d.vals[f] !== now[f] ? ` class="chg"` : ""}></label>`;
      return `<div class="tset open${d ? " editing" : ""}" data-sid="${esc(s.id)}">
        ${head}${d ? `<div class="newset setedit">${field("collection", "Collection", ` list="colList"`)}${field("unit", "Unit", ` list="unitList"`)}${field("name", "Set name")}${field("tags", "Tags (optional)", ` placeholder="Verbs, Quiz 3"`)}</div>` : ""}
        ${rows ? `<div class="tscroll"><table><thead><tr><th>English</th><th>Kana</th><th>Kanji</th>${d ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted small">No words yet.${canEdit() ? " Tap Edit to add some." : ""}</p>`}
        ${d ? `<div class="tactions"><button class="btn" data-add>Add word</button></div>
          <div class="tactions editbar"><button class="btn primary" data-save ${dirty ? "" : "disabled"}>Save</button><button class="btn" data-discard>${dirty ? "Discard changes" : "Cancel"}</button><span class="editerr" data-editerr></span>
          <span style="flex:1"></span>${del ? `<span class="small">Delete this set for everyone?</span><button class="btn danger" data-delset-yes>Delete</button><button class="btn" data-delset-no>Keep</button>` : `<button class="ghost small" data-delset>Delete set</button>`}</div>` : ""}
      </div>`;
    }).join("");
    box.querySelectorAll(".tset").forEach((el) => {
      const sid = el.dataset.sid, s = S.sets.find((x) => x.id === sid), d = canEdit() ? S.drafts.get(sid) : null;
      el.querySelector("[data-toggle]").onclick = () => {
        if (q) return; // search results always stay open
        // Closing a set that was opened for editing and left as it was ends the editing too.
        if (S.openSets.has(sid)) { S.openSets.delete(sid); if (!dirtySet(s)) S.drafts.delete(sid); } else S.openSets.add(sid);
        renderTable();
      };
      const ed = el.querySelector("[data-edit]");
      if (ed) {
        ed.onclick = () => { startEdit(s); renderTable(); const f = document.querySelector(`[data-sid="${CSS.escape(sid)}"] textarea`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } };
      }
      if (!d || !el.classList.contains("open")) return;
      const was = new Map(s.words.map((w) => [w.id, w])), err = (m) => { el.querySelector("[data-editerr]").textContent = m; };
      // A field was typed in: its "changed" mark, and the set drawn again only when it turns unsaved or back.
      const unsavedThen = dirtySet(s), typed = (inp, changed) => { inp.classList.toggle("chg", changed); err(""); if (dirtySet(s) !== unsavedThen) renderTableKeepFocus(inp.id); };
      el.querySelectorAll("textarea[data-f]").forEach((inp) => {
        fit(inp);
        inp.addEventListener("input", () => {
          const w = d.words[+inp.dataset.i], f = inp.dataset.f;
          w[f] = inp.value.replace(/\s*\n\s*/g, " ");
          if (q) S.touched.add(w.id);
          fit(inp); typed(inp, w[f].trim() !== (was.get(w.id)?.[f] || "").trim());
        });
        // Enter goes on to the next field (and from the last one, to a new word) instead of breaking the line.
        inp.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.isComposing) return;
          e.preventDefault();
          const all = [...el.querySelectorAll("textarea[data-f]")], next = all[all.indexOf(inp) + 1];
          next ? next.focus() : el.querySelector("[data-add]").click();
        });
      });
      el.querySelectorAll("[data-ef]").forEach((inp) => inp.addEventListener("input", () => { d.vals[inp.dataset.ef] = inp.value; typed(inp, inp.value !== setVals(s)[inp.dataset.ef]); }));
      el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { d.words.splice(+b.dataset.del, 1); renderTable(); }));
      el.querySelector("[data-add]").onclick = () => { const w = blankWord(); d.words.push(w); renderTableKeepFocus(`w-${sid}-${w.id}-en`); };
      el.querySelector("[data-save]").onclick = async (ev) => {
        ev.target.disabled = true; ev.target.textContent = "Saving…";
        if (await saveSet(s, err)) renderTable(); else { ev.target.disabled = false; ev.target.textContent = "Save"; }
      };
      el.querySelector("[data-discard]").onclick = () => { S.drafts.delete(sid); S.confirmDel = null; renderTable(); };
      const d1 = el.querySelector("[data-delset]"); if (d1) d1.onclick = () => { S.confirmDel = sid; renderTable(); };
      const dn = el.querySelector("[data-delset-no]"); if (dn) dn.onclick = () => { S.confirmDel = null; renderTable(); };
      const dy = el.querySelector("[data-delset-yes]"); if (dy) dy.onclick = async () => { S.confirmDel = null; S.drafts.delete(sid); try { await vdb.doc("sets/" + sid).delete(); } catch {} };
    });
    const back = fresh ? box.querySelector(`[data-sid="${CSS.escape(fresh)}"] textarea`) : typing && document.getElementById(typing.id);
    if (back && back !== document.activeElement) { back.focus(); if (!fresh && typing.pos != null && back.setSelectionRange) back.setSelectionRange(typing.pos, typing.pos); }
  }
  // Draws the table again and puts the cursor in the field with this id (a word just added; otherwise it stays where it was).
  function renderTableKeepFocus(id) { renderTable(); const el = document.getElementById(id); if (el && el !== document.activeElement) el.focus(); }
  $("#newSetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const col = canonCol($("#nsCol").value), unit = canonUnit(col, $("#nsUnit").value), name = tidy($("#nsName").value, 200), tags = cleanTags($("#nsTags").value);
    if (!col || !unit || !name) return;
    if (S.sets.some((s) => sameName(colOf(s), col) && sameName(s.unit, unit) && sameName(s.name, name))) { $("#nsName").setCustomValidity("That set already exists"); $("#nsName").reportValidity(); $("#nsName").setCustomValidity(""); return; }
    const id = freeId(slug(`${col}-${unit}-${name}`, "set"), new Set(S.sets.map((s) => s.id)));
    pickUnit(unit, col);
    S.openSets.add(id); S.editNew = id;
    clearSearch();
    try {
      await vdb.doc("sets/" + id).set({ collection: col, unit, name, ...(tags.length ? { tags } : {}), words: [blankWord()], updatedAt: new Date().toISOString() });
      e.target.reset(); $("#nsCol").value = col; $("#nsUnit").value = unit;
    } catch { banner("Couldn't add the set. Only the owner and editors can change the table."); }
  });

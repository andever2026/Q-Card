  // ---------- vocab table ----------
  const onlyKanji = (raw) => [...new Set([...String(raw)].filter((c) => KANJI.test(c) && c !== "々"))].join("");
  function renderKanji() {
    $("#newKanjiForm").hidden = !canWrite;
    const box = $("#kanjiLists"), all = S.kanjiLists;
    // The lists for the units picked in the vocab table, or every list.
    const picked = all.filter((k) => TP.has(unitKey(k))), every = S.kAll || picked.length === all.length;
    const lists = all.filter((k) => every || TP.has(unitKey(k)) || S.kdrafts.has(k.id)), name = unitTitle;
    $("#kanjiCount").textContent = lists.length ? `${new Set(lists.flatMap((k) => [...(k.kanji || "")])).size} kanji` : "";
    $("#kSummary").textContent = !all.length ? "" : every && all.length > 1 ? `All ${all.length} kanji lists` : lists.length === 1 ? name(lists[0]) : lists.length ? `${lists.length} kanji lists` : "";
    $("#kAllBtn").hidden = !all.length || picked.length === all.length;
    $("#kAllBtn").textContent = S.kAll ? "Show only the picked units" : "Show all units";
    if (!all.length) { box.innerHTML = `<div class="empty"><span>No kanji lists yet${canWrite ? ". Add a unit below and paste its kanji." : "."}</span></div>`; return; }
    if (!lists.length) { box.innerHTML = `<div class="empty"><span>${TP.shownKeys().length ? "The picked units have no kanji lists" : "No units picked"}${canWrite ? ". Add one below if a unit teaches kanji." : "."}</span></div>`; return; }
    box.innerHTML = lists.map((k) => {
      const dirty = S.kdrafts.has(k.id), v = dirty ? S.kdrafts.get(k.id) : k.kanji || "", del = S.kConfirmDel === k.id;
      const editing = canWrite && S.kEdit === k.id;
      const head = editing
        ? `<form class="newset setedit" data-kform><label>Collection<input data-kcol list="colList" value="${esc(S.kEditCol)}" required></label><label>Unit<input data-kunit list="unitList" value="${esc(S.kEditUnit)}" required></label><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-kcancel>Cancel</button><span class="editerr" data-kerr></span></form>`
        : `<div class="head"><h2>${esc(name(k))}</h2><span class="muted small" data-kcount="${esc(k.id)}">${onlyKanji(v).length} kanji</span></div>`;
      if (!canWrite) return `<div class="krow">${head}<span class="ro">${esc(v) || "—"}</span></div>`;
      return `<div class="krow" data-kid="${esc(k.id)}">${head}
        <input type="text" id="k-${esc(k.id)}" value="${esc(v)}" placeholder="Paste this unit's kanji" aria-label="Kanji for ${esc(name(k))}">
        <div class="tactions"><button class="btn primary" data-ksave ${dirty ? "" : "disabled"}>Save</button>${dirty ? `<span class="dirty">Unsaved changes</span><button class="link" data-kdiscard>Discard</button>` : ""}
          <span style="flex:1"></span>${del ? `<span class="small">Delete this kanji list?</span><button class="btn danger" data-kdel-yes>Delete</button><button class="btn" data-kdel-no>Keep</button>` : `${editing ? "" : `<button class="ghost small" data-kedit>Edit unit</button>`}<button class="ghost small" data-kdel>Delete list</button>`}</div>
      </div>`;
    }).join("");
    if (!canWrite) return;
    box.querySelectorAll("[data-kid]").forEach((row) => {
      const id = row.dataset.kid, k = lists.find((x) => x.id === id), inp = row.querySelector(`#k-${CSS.escape(id)}`);
      inp.addEventListener("input", () => {
        const was = S.kdrafts.has(id), now = inp.value !== (k.kanji || "");
        now ? S.kdrafts.set(id, inp.value) : S.kdrafts.delete(id);
        const kc = row.querySelector("[data-kcount]"); if (kc) kc.textContent = `${onlyKanji(inp.value).length} kanji`;
        if (was !== now) { const pos = inp.selectionStart; renderKanji(); const el = document.getElementById(inp.id); el.focus(); el.setSelectionRange(pos, pos); }
      });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && S.kdrafts.has(id)) row.querySelector("[data-ksave]").click(); });
      row.querySelector("[data-ksave]").onclick = async (ev) => {
        const b = ev.currentTarget, kanji = onlyKanji(S.kdrafts.get(id) || "");
        b.disabled = true; b.textContent = "Saving…";
        try { await db.doc("kanji/" + id).update({ kanji, updatedAt: new Date().toISOString() }); S.kdrafts.delete(id); }
        catch { b.textContent = "Save failed, try again"; b.disabled = false; return; }
        renderKanji();
      };
      const dis = row.querySelector("[data-kdiscard]"); if (dis) dis.onclick = () => { S.kdrafts.delete(id); renderKanji(); };
      const d1 = row.querySelector("[data-kdel]"); if (d1) d1.onclick = () => { S.kConfirmDel = id; renderKanji(); };
      const dn = row.querySelector("[data-kdel-no]"); if (dn) dn.onclick = () => { S.kConfirmDel = null; renderKanji(); };
      const dy = row.querySelector("[data-kdel-yes]"); if (dy) dy.onclick = async () => { S.kConfirmDel = null; S.kdrafts.delete(id); try { await db.doc("kanji/" + id).delete(); } catch { banner("Couldn't delete that kanji list. Reload and try again."); } };
      const ke = row.querySelector("[data-kedit]"); if (ke) ke.onclick = () => { S.kEdit = id; S.kEditUnit = k.unit; S.kEditCol = colOf(k); renderKanji(); row.ownerDocument.querySelector(`[data-kid="${CSS.escape(id)}"] [data-kunit]`)?.focus(); };
      const kf = row.querySelector("[data-kform]");
      if (kf) {
        const err = (m) => { kf.querySelector("[data-kerr]").textContent = m; };
        kf.querySelector("[data-kunit]").addEventListener("input", (e) => { S.kEditUnit = e.target.value; err(""); });
        kf.querySelector("[data-kcol]").addEventListener("input", (e) => { S.kEditCol = e.target.value; err(""); });
        kf.querySelector("[data-kcancel]").onclick = () => { S.kEdit = null; renderKanji(); };
        kf.onsubmit = async (e) => {
          e.preventDefault();
          const col = canonCol(S.kEditCol), unit = canonUnit(col, S.kEditUnit);
          if (!unit || !col) return err("Type a collection and a unit.");
          if (S.kanjiLists.some((x) => x.id !== id && sameName(colOf(x), col) && sameName(x.unit, unit))) return err(`${col} › ${unit} already has a kanji list.`);
          const b = kf.querySelector("[type=submit]"); b.disabled = true; b.textContent = "Saving…";
          try { await db.doc("kanji/" + id).update({ collection: col, unit, updatedAt: new Date().toISOString() }); }
          catch { b.disabled = false; b.textContent = "Save"; return err("Couldn't save. Try again."); }
          if (S.upto === unitKey(k)) { S.upto = unitKey({ collection: col, unit }); store.set("uptoPick", S.upto); }
          S.kEdit = null; pickUnit(unit, col);
          renderTable(); renderUpto();
        };
      }
    });
  }
  $("#newKanjiForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const col = canonCol($("#nkCol").value), unit = canonUnit(col, $("#nkUnit").value); if (!unit || !col) return;
    pickUnit(unit, col); renderTable();
    if (S.kanjiLists.some((k) => sameName(colOf(k), col) && sameName(k.unit, unit))) { e.target.reset(); $("#nkCol").value = col; return; }
    const id = freeId(slug(`${col}-${unit}`, "kanji"), new Set(S.kanjiLists.map((k) => k.id)));
    try { await db.doc("kanji/" + id).set({ collection: col, unit, kanji: "", updatedAt: new Date().toISOString() }); e.target.reset(); $("#nkCol").value = col; }
    catch { banner("Couldn't add the kanji list. Only the owner and editors can change the table."); }
  });
  function onKanji(snap) {
    raw.kanji = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    S.kLoaded = true;
    S.kanjiLists = snap.docs.map((d) => { const x = d.data(); return { id: d.id, collection: docCol(x), unit: docUnit(x), kanji: String(x.kanji ?? "") }; }).sort(sortLists);
    renderUpto(); renderTable(); renderSetup();
  }

  // Units picked like on the practice page, sets folded until opened; a search looks across every unit.
  // Unit chips come from every unit used by a vocab set or a kanji list.
  const tKeys = (b) => [...new Set([...S.sets, ...S.kanjiLists].filter((x) => colOf(x) === b).map((x) => x.unit))].sort(byUnit).map((c) => `${b}\u0001${c}`);
  const TP = makePicker({ st: S.tpick, showKey: "tShow", chsKey: "tChs", cols, keys: tKeys, bar: $("#tPickBar"), rows: $("#tChs"),
    dot: (k) => (S.sets.some((s) => S.drafts.has(s.id) && unitKey(s) === k) ? `<span class="dot" title="Unsaved changes">•</span>` : ""),
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
    $("#bookOrderBtn").hidden = !canWrite || cols().length < 2 || !!S.orderEdit;
    TP.render(); syncGroupSegs();
    renderBookOrder();
  }
  $("#bookOrderBtn").onclick = () => { S.orderEdit = cols(); renderTable(); };
  // Collection order editor: move collections up or down, then Save. "Kanji learned up to" counts collections in this order.
  function renderBookOrder() {
    const ed = $("#bookOrderEd"), cur = cols();
    if (S.orderEdit) S.orderEdit = [...S.orderEdit.filter((b) => cur.includes(b)), ...cur.filter((b) => !S.orderEdit.includes(b))];
    ed.hidden = !S.orderEdit || cur.length < 2 || !canWrite;
    if (ed.hidden) { ed.innerHTML = ""; return; }
    const o = S.orderEdit, changed = o.some((b, i) => b !== cur[i]);
    ed.innerHTML = `<p class="muted small" style="margin:0">Put the collections in the order you study them. “Kanji learned up to” counts every kanji in the collections above the one you pick.</p>
      <ol>${o.map((b, i) => `<li><span class="n">${i + 1}</span><b>${esc(colLabel(b))}</b><button class="ghost" type="button" data-bup="${i}" aria-label="Move ${esc(colLabel(b))} up"${i ? "" : " disabled"}>↑</button><button class="ghost" type="button" data-bdown="${i}" aria-label="Move ${esc(colLabel(b))} down"${i < o.length - 1 ? "" : " disabled"}>↓</button></li>`).join("")}</ol>
      <div class="row"><button class="btn primary" type="button" id="boSave"${changed ? "" : " disabled"}>Save order</button><button class="btn" type="button" id="boCancel">Cancel</button><span class="muted small">${changed ? "Unsaved changes" : ""}</span><span class="editerr" id="boErr"></span></div>`;
    const move = (i, d) => { const j = i + d; [o[i], o[j]] = [o[j], o[i]]; renderBookOrder(); ed.querySelector(`[data-b${d < 0 ? "up" : "down"}="${j}"]:not(:disabled)`)?.focus(); };
    ed.querySelectorAll("[data-bup]").forEach((b) => (b.onclick = () => move(+b.dataset.bup, -1)));
    ed.querySelectorAll("[data-bdown]").forEach((b) => (b.onclick = () => move(+b.dataset.bdown, 1)));
    $("#boCancel").onclick = () => { S.orderEdit = null; renderTable(); };
    $("#boSave").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Saving…";
      try { await db.doc("meta/books").set({ order: o, updatedAt: new Date().toISOString() }); S.orderEdit = null; onBookOrder({ exists: true, data: () => ({ order: o }) }); }
      catch { e.target.disabled = false; e.target.textContent = "Save order"; $("#boErr").textContent = "Couldn't save. Try again."; }
    };
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

  function renderTable(searchOnly) {
    if (!searchOnly) { renderKanji(); renderPort(); }
    $("#tableRole").hidden = canWrite;
    $("#newSetForm").hidden = !canWrite;
    $("#colList").innerHTML = cols().filter(Boolean).map((b) => `<option value="${esc(b)}"></option>`).join("");
    // Prefill the Collection fields with the collection being viewed, keeping anything typed until the view moves to another one.
    if (S.formCol !== curCol()) { S.formCol = curCol(); for (const id of ["#nsCol", "#nkCol"]) $(id).value = S.formCol; }
    else for (const id of ["#nsCol", "#nkCol"]) if (!$(id).value && document.activeElement !== $(id)) $(id).value = S.formCol;
    $("#unitList").innerHTML = tKeys(S.formCol).map((k) => `<option value="${esc(keyUnit(k))}"></option>`).join("");
    const box = $("#setTables");
    const bar = $(".tbar"); bar.hidden = !S.loaded || !S.sets.length;
    if (!S.loaded) { box.innerHTML = `<div class="empty">Loading…</div>`; return; }
    if (!S.sets.length) { box.innerHTML = `<div class="empty"><b>No sets yet.</b><span>${canWrite ? "Add a set below, then fill in its words." : ""}</span></div>`; return; }
    renderTableBar();
    const q = S.tq.trim(), keys = TP.shownKeys(), allKeys = cols().flatMap(tKeys);
    // Each shown set: which rows (indexes into the full word list) to draw, and whether it is open.
    // While searching, only the first TLIMIT matches are drawn (edited and blank rows always are).
    const shown = [], qk = { en: q.toLowerCase(), jp: hira(q) };
    let total = 0, drawn = 0;
    for (const s of S.sets) {
      const words = S.drafts.get(s.id) || s.words;
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
        shown.push({ s, words, idx: words.map((w, i) => i), open: S.openSets.has(s.id) });
      }
    }
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const [b1, c1] = (keys[0] || "").split("\u0001");
    const where = keys.length === 1 ? `${multiCol() ? colLabel(b1) + " › " : ""}${c1}` : keys.length === allKeys.length ? (multiCol() ? "All collections" : "All units") : plural(keys.length, "unit");
    $("#tSummary").textContent = q
      ? (!total ? "" : drawn < total ? `Showing the first ${drawn} of ${total} matches. Keep typing to narrow it down.` : `${plural(total, "matching word")} in ${plural(shown.length, "set")}, ${multiCol() ? "all collections" : "all units"}`)
      : !keys.length ? "" : `${where}: ${plural(shown.length, "set")}, ${plural(shown.reduce((n, x) => n + readyCount(x.words), 0), "word")}`;
    const openAll = $("#tOpenAll"); openAll.hidden = q ? drawn >= total : !shown.length;
    openAll.textContent = q ? `Show all ${total}` : shown.every((x) => x.open) ? "Close all sets" : "Open all sets";
    if (q && !shown.length) { box.innerHTML = `<div class="empty"><b>No words match “${esc(q)}”.</b><span>Search looks at English, kana and kanji in every ${multiCol() ? "collection and unit" : "unit"}.</span></div>`; return; }
    if (!keys.length) { box.innerHTML = `<div class="empty"><span>No units picked. Tap All or a unit above to see its sets.</span></div>`; return; }
    if (!shown.length) { box.innerHTML = `<div class="empty"><span>${esc(where)} ${keys.length === 1 ? "has" : "have"} no vocab sets yet${canWrite ? ". Add one below." : "."}</span></div>`; return; }
    const manyCols = new Set(shown.map(({ s }) => colOf(s))).size > 1;
    box.innerHTML = shown.map(({ s, words, idx, open }) => {
      const dirty = S.drafts.has(s.id);
      const head = `<h3 class="tseth"><button class="tsethead" type="button" data-toggle aria-expanded="${open}"><span class="t"><span class="car" aria-hidden="true">›</span>${esc(q || manyCols ? setName(s) : `${s.unit} › ${s.name}`)}${cleanTags(s.tags).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
        <span class="small">${dirty ? `<span class="dirty">Unsaved changes</span> ` : ""}<span class="muted">${q ? `${idx.length} of ${plural(words.length, "word")}` : plural(readyCount(words), "word")}</span></span></button></h3>`;
      if (!open) return `<div class="tset" data-sid="${esc(s.id)}">${head}</div>`;
      const rows = idx.map((i) => { const w = words[i]; return canWrite
        ? `<tr><td><input type="text" id="w-${s.id}-${w.id}-en" data-i="${i}" data-f="en" value="${esc(w.en)}" placeholder="English"></td>
             <td class="jp"><input type="text" id="w-${s.id}-${w.id}-kana" data-i="${i}" data-f="kana" value="${esc(w.kana)}" placeholder="Kana"></td>
             <td class="jp"><input type="text" id="w-${s.id}-${w.id}-kanji" data-i="${i}" data-f="kanji" value="${esc(w.kanji)}" placeholder="Kanji"></td>
             <td class="c"><button class="rowdel" data-del="${i}" aria-label="Delete row">×</button></td></tr>`
        : `<tr><td>${esc(w.en)}</td><td class="jp">${esc(w.kana)}</td><td class="jp">${esc(w.kanji)}</td></tr>`; }).join("");
      const del = S.confirmDel === s.id, ev = canWrite && S.editSet === s.id && S.editVals;
      const edit = ev ? `<form class="newset setedit" data-editform>
          <label>Collection<input data-ef="collection" list="colList" value="${esc(ev.collection)}" required></label>
          <label>Unit<input data-ef="unit" list="unitList" value="${esc(ev.unit)}" required></label>
          <label>Set name<input data-ef="name" value="${esc(ev.name)}" required></label>
          <label>Tags (optional)<input data-ef="tags" value="${esc(ev.tags)}" placeholder="Verbs, Quiz 3"></label>
          <button class="btn primary" type="submit">Save details</button><button class="btn" type="button" data-editcancel>Cancel</button><span class="editerr" data-editerr></span>
        </form>` : "";
      return `<div class="tset" data-sid="${esc(s.id)}">
        ${head}${edit}
        <div class="tscroll"><table><thead><tr><th>English</th><th>Kana</th><th>Kanji</th>${canWrite ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>
        ${canWrite ? `<div class="tactions"><button class="btn" data-add>Add word</button><button class="btn primary" data-save ${dirty ? "" : "disabled"}>Save</button>${dirty ? `<button class="link" data-discard>Discard</button>` : ""}
          <span style="flex:1"></span>${del ? `<span class="small">Delete this set for everyone?</span><button class="btn danger" data-delset-yes>Delete</button><button class="btn" data-delset-no>Keep</button>` : `${ev ? "" : `<button class="ghost small" data-editset>Edit details</button>`}<button class="ghost small" data-delset>Delete set</button>`}</div>` : ""}
      </div>`;
    }).join("");
    box.querySelectorAll(".tset").forEach((el) => {
      const sid = el.dataset.sid;
      el.querySelector("[data-toggle]").onclick = () => {
        if (q) return; // search results always stay open
        S.openSets.has(sid) ? S.openSets.delete(sid) : S.openSets.add(sid);
        renderTable();
      };
    });
    if (!canWrite) return;
    box.querySelectorAll(".tset").forEach((el) => {
      const sid = el.dataset.sid, s = S.sets.find((x) => x.id === sid);
      if (!el.querySelector("table")) return;
      const draft = () => { if (!S.drafts.has(sid)) S.drafts.set(sid, s.words.map((w) => ({ ...w }))); S.openSets.add(sid); return S.drafts.get(sid); };
      el.querySelectorAll("input[data-f]").forEach((inp) => {
        inp.addEventListener(inp.type === "checkbox" ? "change" : "input", () => {
          const ws = draft(), w = ws[+inp.dataset.i], f = inp.dataset.f;
          w[f] = inp.type === "checkbox" ? inp.checked : inp.value;
          if (q) S.touched.add(w.id);
          const wasDirty = el.querySelector(".dirty");
          if (!wasDirty) renderTableKeepFocus(inp.id);
        });
      });
      el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { draft().splice(+b.dataset.del, 1); renderTable(); }));
      el.querySelector("[data-add]").onclick = () => { const ws = draft(); const w = { id: rid(), en: "", kana: "", kanji: "" }; ws.push(w); renderTableKeepFocus(`w-${sid}-${w.id}-en`); };
      el.querySelector("[data-save]").onclick = async (ev) => {
        const ws = (S.drafts.get(sid) || s.words).map((w) => ({ id: w.id || rid(), en: (w.en || "").trim(), kana: (w.kana || "").trim(), kanji: (w.kanji || "").trim() })).filter((w) => w.en || w.kana || w.kanji);
        ev.target.disabled = true; ev.target.textContent = "Saving…";
        try { await db.doc("sets/" + sid).update({ words: ws, updatedAt: new Date().toISOString() }); S.drafts.delete(sid); }
        catch { ev.target.textContent = "Save failed, try again"; ev.target.disabled = false; return; }
        renderTable();
      };
      const dis = el.querySelector("[data-discard]"); if (dis) dis.onclick = () => { S.drafts.delete(sid); renderTable(); };
      const d1 = el.querySelector("[data-delset]"); if (d1) d1.onclick = () => { S.confirmDel = sid; renderTable(); };
      const dn = el.querySelector("[data-delset-no]"); if (dn) dn.onclick = () => { S.confirmDel = null; renderTable(); };
      const dy = el.querySelector("[data-delset-yes]"); if (dy) dy.onclick = async () => { S.confirmDel = null; S.drafts.delete(sid); try { await db.doc("sets/" + sid).delete(); } catch {} };
      const es = el.querySelector("[data-editset]");
      if (es) es.onclick = () => { S.editSet = sid; S.editVals = { collection: colOf(s), unit: s.unit, name: s.name, tags: cleanTags(s.tags).join(", ") }; renderTable(); document.querySelector(`[data-sid="${CSS.escape(sid)}"] [data-ef="name"]`)?.focus(); };
      const ef = el.querySelector("[data-editform]");
      if (ef) {
        const err = (m) => { ef.querySelector("[data-editerr]").textContent = m; };
        ef.querySelectorAll("[data-ef]").forEach((inp) => inp.addEventListener("input", () => { S.editVals[inp.dataset.ef] = inp.value; err(""); }));
        ef.querySelector("[data-editcancel]").onclick = () => { S.editSet = null; renderTable(); };
        ef.onsubmit = async (e) => {
          e.preventDefault();
          const col = canonCol(S.editVals.collection), unit = canonUnit(col, S.editVals.unit), name = tidy(S.editVals.name, 200), tags = cleanTags(S.editVals.tags);
          if (!col || !unit || !name) return err("Collection, unit and set name can't be empty.");
          if (S.sets.some((x) => x.id !== sid && sameName(colOf(x), col) && sameName(x.unit, unit) && sameName(x.name, name))) return err(`${col} › ${unit} › ${name} already exists.`);
          const b = ef.querySelector("[type=submit]"); b.disabled = true; b.textContent = "Saving…";
          try { await db.doc("sets/" + sid).update({ collection: col, unit, name, tags, updatedAt: new Date().toISOString() }); }
          catch { b.disabled = false; b.textContent = "Save details"; return err("Couldn't save. Try again."); }
          S.editSet = null; S.openSets.add(sid); pickUnit(unit, col);
          renderTable();
        };
      }
    });
  }
  function renderTableKeepFocus(id) {
    const a = document.activeElement, pos = a && a.selectionStart;
    renderTable();
    const el = document.getElementById(id); if (el) { el.focus(); if (pos != null && el.setSelectionRange && a && a.id === id) el.setSelectionRange(pos, pos); }
  }
  $("#newSetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const col = canonCol($("#nsCol").value), unit = canonUnit(col, $("#nsUnit").value), name = tidy($("#nsName").value, 200), tags = cleanTags($("#nsTags").value);
    if (!col || !unit || !name) return;
    if (S.sets.some((s) => sameName(colOf(s), col) && sameName(s.unit, unit) && sameName(s.name, name))) { $("#nsName").setCustomValidity("That set already exists"); $("#nsName").reportValidity(); $("#nsName").setCustomValidity(""); return; }
    const id = freeId(slug(`${col}-${unit}-${name}`, "set"), new Set(S.sets.map((s) => s.id)));
    pickUnit(unit, col);
    S.openSets.add(id);
    clearSearch();
    try {
      await db.doc("sets/" + id).set({ collection: col, unit, name, ...(tags.length ? { tags } : {}), words: [{ id: rid(), en: "", kana: "", kanji: "" }], updatedAt: new Date().toISOString() });
      e.target.reset(); $("#nsCol").value = col; $("#nsUnit").value = unit;
    } catch { banner("Couldn't add the set. Only the owner and editors can change the table."); }
  });

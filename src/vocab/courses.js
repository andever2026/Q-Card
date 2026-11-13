  // ---------- courses ----------
  // A course is a row of the unit pickers when rows are by Course: a name and ranges of units, each from one collection
  // ({ collection, from, to }, stored in meta/courses). A unit goes in the first course that covers it.
  // rows: each course with the units it shows (keys) and every unit its ranges cover (covers); rest: units no course has.
  function courseRows(all, courses) {
    const used = new Set();
    const inPart = (k, pt) => { const [b, u] = k.split("\u0001"); return b === pt.collection && byUnit(u, pt.from) >= 0 && byUnit(u, pt.to) <= 0; };
    const rows = courses.map((c) => {
      const covers = all.filter((k) => c.parts.some((pt) => inPart(k, pt))), keys = covers.filter((k) => !used.has(k));
      keys.forEach((k) => used.add(k));
      return { name: c.name, keys, covers };
    });
    return { rows, rest: all.filter((k) => !used.has(k)) };
  }

  // The editor in the vocab table: S.courseEdit is a copy of the courses, stored only on Save.
  // A name may hold one line break, which shows the name on two lines beside the units.
  const courseName = (n) => String(n).split("\n").map((t) => tidy(t, 100)).filter(Boolean).slice(0, 2).join("\n").slice(0, 100);
  const keptCourses = (list) => list.map((c) => ({ name: courseName(c.name), parts: c.parts.map(({ collection, from, to }) => ({ collection, from, to })) }));
  const coursesDirty = () => !!S.courseEdit && JSON.stringify(keptCourses(S.courseEdit)) !== JSON.stringify(keptCourses(S.courses));
  const colUnits = (b) => tKeys(b).map(keyUnit);
  const wholeCol = (b) => { const us = colUnits(b); return { collection: b, from: us[0] ?? "", to: us[us.length - 1] ?? "" }; };
  $("#courseBtn").onclick = () => { S.courseEdit = keptCourses(S.courses); renderTable(); $("#courseEd").querySelector("textarea, [data-cadd]")?.focus(); };

  function renderCourses() {
    const ed = $("#courseEd"), e = S.courseEdit;
    $("#courseBtn").hidden = !canWrite || !cols().length || !!e;
    ed.hidden = !e || !canWrite;
    if (ed.hidden) { ed.innerHTML = ""; return; }
    const changed = coursesDirty();
    ed.innerHTML = `<p class="muted small" style="margin:0">With rows by Course, each course is one row of units. A unit goes in the first course that has it, and units no course has show under “Other”. Press Enter in a name to put it on two lines.</p>
      ${e.length ? `<ol class="courses">${e.map((c, i) => `<li data-c="${i}">
        <div class="chead"><span class="n">${i + 1}</span><textarea rows="${c.name.includes("\n") ? 2 : 1}" data-cname maxlength="100" placeholder="Course name, like Japanese 2" aria-label="Name of course ${i + 1}">${esc(c.name)}</textarea><span class="muted small csum" data-csum></span>
          <button class="ghost" type="button" data-cmove="-1" aria-label="Move course ${i + 1} up"${i ? "" : " disabled"}>↑</button><button class="ghost" type="button" data-cmove="1" aria-label="Move course ${i + 1} down"${i < e.length - 1 ? "" : " disabled"}>↓</button>
          <button class="ghost small" type="button" data-cdel>Delete</button></div>
        ${c.parts.map((p, j) => `<div class="cpart" data-p="${j}"><div id="cdd-${i}-${j}-collection"></div><span class="crange"><span class="muted small">from</span><div id="cdd-${i}-${j}-from"></div><span class="muted small">to</span><div id="cdd-${i}-${j}-to"></div></span>${c.parts.length > 1 ? `<button class="ghost" type="button" data-pdel aria-label="Remove this range">✕</button>` : ""}</div>`).join("")}
        <div class="cfoot"><button class="link" type="button" data-padd>+ Add units from another collection</button></div>
      </li>`).join("")}</ol>` : `<p class="small" style="margin:0">No courses yet.</p>`}
      <div class="row"><button class="btn" type="button" data-cadd>+ Add a course</button><span class="muted small" data-crest></span></div>
      <div class="row"><button class="btn primary" type="button" id="coSave"${changed ? "" : " disabled"}>Save courses</button><button class="btn" type="button" id="coCancel">Cancel</button><span class="muted small" data-cstate>${changed ? "Unsaved changes" : ""}</span><span class="editerr" id="coErr"></span></div>`;
    const redo = (focus) => { renderCourses(); renderLeave(); if (focus) ed.querySelector(focus)?.focus(); };
    // What each course ends up showing, where the units it covers but an earlier course has went, and what's left for "Other".
    // Also while a name is typed, which redraws nothing else (a redraw then would lose the next click).
    const units = (n) => `${n} unit${n === 1 ? "" : "s"}`;
    const sums = () => {
      const { rows, rest } = courseRows(cols().flatMap(tKeys), keptCourses(e)), ch = coursesDirty();
      ed.querySelectorAll("[data-csum]").forEach((el, i) => {
        const r = rows[i], gone = r.covers.filter((k) => !r.keys.includes(k)), by = [...new Set(gone.map((k) => rows.findIndex((x, j) => j < i && x.keys.includes(k))))];
        el.textContent = `${units(r.keys.length)}${gone.length ? ` · ${units(gone.length)} already in ${by.map((j) => `“${rows[j].name.replace("\n", " ") || `course ${j + 1}`}”`).join(", ")}` : ""}`;
      });
      ed.querySelector("[data-crest]").textContent = rest.length ? `${units(rest.length)} in no course, under “Other”` : "Every unit is in a course";
      $("#coSave").disabled = !ch; ed.querySelector("[data-cstate]").textContent = ch ? "Unsaved changes" : "";
    };
    ed.querySelectorAll("[data-c]").forEach((li) => {
      const i = +li.dataset.c, c = e[i], nm = li.querySelector("[data-cname]");
      nm.addEventListener("input", () => {
        if (nm.value.split("\n").length > 2) { const at = nm.selectionStart - 1; nm.value = nm.value.replace(/\n(?=[^\n]*\n)/, " "); nm.setSelectionRange(at, at); }
        c.name = nm.value; nm.rows = nm.value.includes("\n") ? 2 : 1; $("#coErr").textContent = ""; sums(); renderLeave();
      });
      li.querySelectorAll("[data-cmove]").forEach((b) => (b.onclick = () => {
        const d = +b.dataset.cmove; e.splice(i + d, 0, ...e.splice(i, 1));
        redo(`[data-c="${i + d}"] [data-cmove="${d}"]:not(:disabled)`);
      }));
      li.querySelector("[data-cdel]").onclick = () => { e.splice(i, 1); redo(`[data-c="${Math.min(i, e.length - 1)}"] [data-cname]`); };
      li.querySelector("[data-padd]").onclick = () => {
        const used = c.parts.map((p) => p.collection);
        c.parts.push(wholeCol(cols().find((b) => !used.includes(b)) ?? cols()[0])); redo();
      };
      li.querySelectorAll("[data-p]").forEach((row) => {
        const j = +row.dataset.p, p = c.parts[j], us = colUnits(p.collection), box = (f) => row.querySelector(`#cdd-${i}-${j}-${f}`);
        // A name no longer in the vocab (renamed or deleted since) stays on the list, so the range shows what it is.
        const opts = (list, v, by) => (list.includes(v) || !v ? list : [...list, v].sort(by)).map((x) => [x, by === byCol ? colLabel(x) : x]);
        makeDropdown(box("collection"), `Collection of course ${i + 1}`, opts(cols(), p.collection, byCol), (v) => { c.parts[j] = wholeCol(v); redo(`#cdd-${i}-${j}-collection .dd-btn`); }).set(p.collection);
        makeDropdown(box("from"), `First unit of this range`, opts(us, p.from, byUnit), (v) => { p.from = v; if (byUnit(p.to, v) < 0) p.to = v; redo(`#cdd-${i}-${j}-from .dd-btn`); }).set(p.from);
        makeDropdown(box("to"), `Last unit of this range`, opts(us, p.to, byUnit), (v) => { p.to = v; if (byUnit(p.from, v) > 0) p.from = v; redo(`#cdd-${i}-${j}-to .dd-btn`); }).set(p.to);
        const del = row.querySelector("[data-pdel]"); if (del) del.onclick = () => { c.parts.splice(j, 1); redo(`[data-c="${i}"] [data-padd]`); };
      });
    });
    sums();
    ed.querySelector("[data-cadd]").onclick = () => { e.push({ name: "", parts: [wholeCol(curCol())] }); redo(`[data-c="${e.length - 1}"] [data-cname]`); };
    $("#coCancel").onclick = () => { S.courseEdit = null; renderTable(); };
    $("#coSave").onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = "Saving…";
      if (!(await saveCourses((m) => { $("#coErr").textContent = m; }))) { b.disabled = false; b.textContent = "Save courses"; }
    };
  }
  // Stores the courses being edited. say shows what's wrong; true = saved.
  async function saveCourses(say) {
    const list = keptCourses(S.courseEdit);
    const twice = list.find((c, i) => list.findIndex((x) => sameName(x.name, c.name)) !== i);
    const bad = list.some((c) => !c.name) ? "Give every course a name." : twice ? `Two courses are called “${twice.name.replace("\n", " ")}”.`
      : list.some((c) => c.parts.some((p) => !p.collection || !p.from || !p.to)) ? "Every range needs a collection and its units." : "";
    if (bad) { say(bad); return false; }
    try { await db.doc("meta/courses").set({ courses: list, updatedAt: new Date().toISOString() }); }
    catch { say("Couldn't save. Try again."); return false; }
    S.courseEdit = null; onCourses({ exists: true, data: () => ({ courses: list }) });
    return true;
  }

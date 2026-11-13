// Made by tools/build.mjs from src/side-pages/ai.js; edit that file instead.
// The AI page (ai/): its Copy button, and its Import, which shows the same preview as Settings → Import right on this page
// and saves where the site keeps this person's vocab. Loaded after the page (defer); without it the page still reads fine.
(() => {
  // Finding an element, and making text safe to put into HTML: for the page and for the AI page's import.
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // A one-line message under a control: sayIn(el)("…") shows it, sayIn(el)("") takes it away.
  const sayIn = (el) => (m) => { el.hidden = !m; el.textContent = m || ""; };
  // Marks which of a menu's buttons is the one showing (the styles key on aria-current).
  const markCurrent = (els, on) => els.forEach((b) => (on(b) ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  // A (?) that shows a short explanation in a bubble when pointed at, focused or (on a touch screen) tapped. qtip(id, label,
  // text) is its HTML (id names the bubble, for aria-describedby); tipTaps(box) makes the ones in box open on a tap.
  const qtip = (id, label, text) => `<span class="qtip" tabindex="0" role="button" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2.9-1.2 1.7v.5"/><circle cx="12" cy="17.2" r=".4" fill="currentColor"/></svg><span class="qtipbody" role="tooltip" id="${id}">${esc(text)}</span></span>`;
  const tipTaps = (box) => box.querySelectorAll(".qtip").forEach((q) => { q.onclick = () => q.classList.toggle("open"); q.onblur = q.onmouseleave = () => q.classList.remove("open"); });
  // ---------- vocab documents ----------
  // What's stored, and how each document is read. Nothing here looks at the page, so the AI page's import uses it too.
  //   sets/<id>      { collection, unit, name, tags?, words: [{ id, en, kana, kanji }] }
  //   kanji/<id>     { collection, unit, kanji }       the kanji a unit teaches, as one string
  //   meta/books     { order: [collection, …] }        the order the collections are studied in
  //   meta/views     { main, views: [{ name, collections: [{ name, units: [{ collection, unit }] }] }] }
  //                  the main view's name, and other ways of grouping the same units into collections (vocab/views.js)
  //   meta/courses   { courses: [{ name, parts: [{ collection, from, to }] }] }   what views replaced, read until views are saved
  // Vocab is grouped Collection › Unit › Set: a collection (a textbook, a course, any list of lists) has units (Ch. 3,
  // Week 1, any name), and each unit has sets; kanji lists go by unit. Documents saved before October 2026 name a book,
  // a numbered chapter and a section with an optional label: they're read as collection, unit "Ch. N" and set name "A · Label".
  const tidy = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const oldUnit = (v) => { const c = tidy(v, 60).replace(/^ch(apter)?\.?\s*(?=\d)/i, ""); return /^\d+$/.test(c) ? `Ch. ${+c}` : c; };
  const docCol = (d) => tidy(d.collection ?? d.book, 100);
  const docUnit = (d) => (d.unit != null ? tidy(d.unit, 60) : oldUnit(d.chapter)) || "No unit";
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  // Units sort by name with numbers in order (Week 2 before Week 10).
  const byUnit = (a, b) => coll.compare(String(a), String(b));
  const docName = (d) => tidy(d.name ?? [d.section, d.label].map((x) => tidy(x, 200)).filter(Boolean).join(" · "), 200) || "Untitled set";
  const colLabel = (b) => b || "No collection";
  // "Genki 1 › Lesson 3" and "Genki 1 › Lesson 3 › Food": the collection is named only where there's more than one (withCol).
  const unitPath = (x, withCol) => `${withCol ? colLabel(x.collection || "") + " › " : ""}${x.unit}`;
  const setPath = (s, withCol) => `${unitPath(s, withCol)} › ${s.name}`;
  // A set's own tags: up to 12 short labels, matched without case; a comma (or 、) separates them when typed.
  const tagKey = (t) => t.toLowerCase();
  function cleanTags(v) {
    const out = [], seen = new Set();
    for (const t of Array.isArray(v) ? v : String(v ?? "").split(/[,、，]/)) {
      const x = tidy(t, 30);
      if (x && !seen.has(tagKey(x)) && out.length < 12) { seen.add(tagKey(x)); out.push(x); }
    }
    return out;
  }
  // A course takes a range of units from one collection, by name: { collection, from, to }. Older courses gave a book and chapter numbers.
  const coursePart = (p) => (p?.collection != null ? { collection: tidy(p.collection, 100), from: tidy(p.from, 60), to: tidy(p.to, 60) }
    : { collection: tidy(p?.book, 100), from: oldUnit(p?.from), to: oldUnit(p?.to) });

  // The documents exactly as stored, with their ids: what Export writes out and Import compares a file with.
  const withIds = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const dataOrNull = (snap) => (snap.exists ? snap.data() : null);
  // All four at once, for a page that doesn't keep them loaded (the AI page; the site itself listens to each, see boot).
  async function readVocab(db) {
    const [sets, kanji, books, courses, views] = await Promise.all([db.collection("sets").get(), db.collection("kanji").get(), db.doc("meta/books").get(), db.doc("meta/courses").get(), db.doc("meta/views").get()]);
    return { sets: withIds(sets), kanji: withIds(kanji), books: dataOrNull(books), courses: dataOrNull(courses), views: dataOrNull(views) };
  }
  // A vocab file (Export writes one, Import reads one, an AI can make one: see ai/) is those documents in one JSON object:
  // { app: APP, version: 2, sets: [...], kanji: [...], collections: { order }, views } (older files: courses instead of views).
  const APP = "jp-vocab-practice";
  // Each cleaner returns the document to store, in the current format, or null when what it's given isn't usable.
  // Files and older documents go through them, so their contents are never trusted.
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
  const rid = () => Math.random().toString(36).slice(2, 9);
  const str = (v, n = 500) => String(v ?? "").slice(0, n);
  const cleanSet = (d) => !d || typeof d !== "object" || !ID_RE.test(String(d.id ?? "")) || !Array.isArray(d.words) ? null : {
    collection: docCol(d), unit: docUnit(d), name: docName(d), ...(cleanTags(d.tags).length ? { tags: cleanTags(d.tags) } : {}),
    words: d.words.slice(0, 3000).filter((w) => w && typeof w === "object").map((w) => ({ id: ID_RE.test(String(w.id ?? "")) ? String(w.id) : rid(), en: str(w.en), kana: str(w.kana), kanji: str(w.kanji) })) };
  const cleanKanji = (d) => !d || typeof d !== "object" || !ID_RE.test(String(d.id ?? "")) ? null : { collection: docCol(d), unit: docUnit(d), kanji: str(d.kanji, 20000) };
  const cleanBooks = (d) => Array.isArray(d?.order) ? { order: d.order.slice(0, 50).map((b) => str(b, 100)) } : null;
  // Courses come as stored ({ courses: [...] }) or, in a hand-made file, as the bare list.
  function cleanCourses(d) {
    const list = Array.isArray(d) ? d : d?.courses;
    return Array.isArray(list) ? { courses: list.slice(0, 50).filter((c) => c && c.name && Array.isArray(c.parts)).map((c) => ({ name: str(c.name, 100),
      parts: c.parts.slice(0, 20).filter((x) => x && typeof x === "object").map(coursePart).filter((x) => x.from && x.to) })) } : null;
  }
  // Courses read as one view, "Courses", each unit in the first course that covers it. units: every unit there is, as
  // { collection, unit }; courses: [{ name, parts }] (cleanCourses).
  function courseView(units, courses) {
    const used = new Set(), inPart = (u, pt) => u.collection === pt.collection && byUnit(u.unit, pt.from) >= 0 && byUnit(u.unit, pt.to) <= 0;
    return { name: "Courses", collections: courses.map((c) => { const us = units.filter((u) => !used.has(u) && c.parts.some((pt) => inPart(u, pt))); us.forEach((u) => used.add(u)); return { name: c.name, units: us }; }) };
  }
  // A name in a view other than the main one may hold one line break, which shows it on two lines beside its units.
  const viewName = (v, n) => String(v ?? "").split("\n").map((t) => tidy(t, n)).filter(Boolean).slice(0, 2).join("\n").slice(0, n);
  function cleanViews(d) {
    if (!d || typeof d !== "object" || !Array.isArray(d.views)) return null;
    const unit = (u) => ({ collection: tidy(u.collection, 100), unit: tidy(u.unit, 60) });
    return { main: tidy(d.main, 60) || "Books", views: d.views.slice(0, 20).filter((v) => v && typeof v === "object" && Array.isArray(v.collections)).map((v) => ({ name: viewName(v.name, 60) || "View",
      collections: v.collections.slice(0, 100).filter((c) => c && typeof c === "object").map((c) => ({ name: viewName(c.name, 100) || "Untitled",
        units: (Array.isArray(c.units) ? c.units : []).slice(0, 1000).filter((u) => u && typeof u === "object" && u.unit).map(unit) })) })) };
  }
  // ---------- importing a vocab file ----------
  // The one importer, used by Settings → Import and by the AI page (ai/). It reads the file, compares it with what's
  // stored, shows a preview, and on Import writes only what's new or changed, one document at a time. Sets that aren't
  // in the file are left alone. It doesn't know where the vocab is kept; whoever makes one says how to read and write it:
  //   button, input    the "Import a file…" button and its hidden file input
  //   box, say         where the preview goes, and how a one-line message is shown (say("") clears it)
  //   stored()         the documents stored now, with their ids: { sets, kanji, books, courses, views } (it may be async)
  //   write(path, doc) saves one document
  //   where()          optional: a line for the preview, saying where the import will be saved
  //   hint             optional: what to do about a file that isn't one of ours, added to that message
  //   changed()        optional: called when writing starts and when it stops
  //   done()           optional: called after an import that wrote everything
  // importer.busy is true while it's writing.
  function makeImporter({ button, input, box, say, stored, write, where, hint = "", changed = () => {}, done = () => {} }) {
    const me = { busy: false };
    let plan = null;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const count = (xs, st) => xs.filter((x) => x.status === st).length;

    // What an import of this file would add or change, compared with what's here; nothing is written yet.
    function planImport(file, name, here) {
      let skipped = 0;
      const walk = (list, have, clean) => {
        const had = new Map(have.map((d) => [d.id, clean(d)])), seen = new Map();
        for (const d of Array.isArray(list) ? list : []) { const c = clean(d); if (c) seen.set(String(d.id), c); else skipped++; }
        return [...seen].map(([id, doc]) => ({ id, doc, status: !had.has(id) ? "new" : same(had.get(id), doc) ? "same" : "changed" }));
      };
      const sets = walk(file.sets, here.sets, cleanSet), kanji = walk(file.kanji, here.kanji, cleanKanji);
      const meta = (v, have, clean) => { const c = v == null ? null : clean(v); if (v != null && !c) skipped++; return c && { doc: c, changed: !same(clean(have), c) }; };
      // Titles name the collection when there's more than one, counting what's here and what the file brings.
      const withCol = new Set([...[...here.sets, ...here.kanji].map(docCol), ...[...sets, ...kanji].map((x) => x.doc.collection)]).size > 1;
      for (const x of sets) x.title = setPath(x.doc, withCol);
      for (const x of kanji) x.title = "Kanji " + unitPath(x.doc, withCol);
      let courses = meta(file.courses, here.courses, cleanCourses), views = meta(file.views, here.views, cleanViews);
      // An older file's courses, where views are saved already (which would hide them), come in as the view "Courses".
      const hasViews = cleanViews(here.views);
      if (courses && !views && hasViews) {
        const units = new Map([...here.sets, ...here.kanji].map((d) => ({ collection: docCol(d), unit: docUnit(d) })).concat([...sets, ...kanji].map((x) => ({ collection: x.doc.collection, unit: x.doc.unit })))
          .map((u) => [`${u.collection}\u0001${u.unit}`, u]));
        const cv = courseView([...units.values()], courses.doc.courses);
        if (cv.name.toLowerCase() === hasViews.main.toLowerCase()) cv.name = "Courses 2";
        const doc = { ...hasViews, views: [...hasViews.views.filter((v) => v.name.toLowerCase() !== cv.name.toLowerCase()), cv] };
        views = { doc, changed: !same(hasViews, doc) }; courses = null;
      }
      return { name, exportedAt: file.exportedAt, sets, kanji, books: meta(file.collections ?? file.books, here.books, cleanBooks), courses, views, skipped };
    }

    function render() {
      const p = plan;
      box.hidden = !p;
      if (!p) { box.innerHTML = ""; return; }
      const line = (xs, noun) => {
        if (!xs.length) return `${noun}: none in the file`;
        const n = count(xs, "new"), c = count(xs, "changed"), k = count(xs, "same");
        if (!n && !c) return `${noun}: all ${xs.length} already the same`;
        return `${noun}: ${[n && `${n} new`, c && `${c} changed`, k && `${k} already the same`].filter(Boolean).join(", ")}`;
      };
      const metaLine = (m, noun) => `${noun}: ${!m ? "not in the file" : m.changed ? "will change" : "already the same"}`;
      const names = (st) => { const xs = [...p.sets, ...p.kanji].filter((x) => x.status === st).map((x) => x.title);
        return xs.length ? `<div class="names"><b>${st === "new" ? "New" : "Changed"}:</b> ${esc(xs.slice(0, 12).join(", "))}${xs.length > 12 ? `, and ${xs.length - 12} more` : ""}</div>` : ""; };
      const todo = p.sets.length - count(p.sets, "same") + p.kanji.length - count(p.kanji, "same") + [p.books, p.courses, p.views].filter((m) => m?.changed).length;
      const when = p.exportedAt && !isNaN(new Date(p.exportedAt)) ? ` · exported ${new Date(p.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "";
      box.innerHTML = `<div><b>${esc(p.name)}</b><span class="muted small">${esc(when)}</span></div>
      <ul class="small"><li>${line(p.sets, "Vocab sets")}</li><li>${line(p.kanji, "Kanji lists")}</li><li>${metaLine(p.books, "Collection order")}</li><li>${p.courses && !p.views ? metaLine(p.courses, "Courses") : metaLine(p.views, "Views")}</li>
      ${p.skipped ? `<li>${p.skipped} ${p.skipped === 1 ? "entry isn't" : "entries aren't"} valid and will be skipped</li>` : ""}</ul>
      ${names("new")}${names("changed")}
      ${todo && where ? `<div class="muted small" data-where>${esc(where())}</div>` : ""}
      <div class="tactions">${todo ? `<button class="btn primary" type="button" id="importGo">Import ${todo} ${todo === 1 ? "change" : "changes"}</button><button class="link" type="button" id="importCancel">Cancel</button>`
        : `<span class="muted small">Everything in this file is already here.</span><button class="link" type="button" id="importCancel">Close</button>`}</div>`;
      box.querySelector("#importCancel").onclick = () => { plan = null; render(); };
      if (todo) box.querySelector("#importGo").onclick = run;
    }

    function busy(on) { me.busy = button.disabled = on; changed(); }
    async function run() {
      const p = plan, now = new Date().toISOString(), todo = (xs) => xs.filter((x) => x.status !== "same");
      const jobs = [...todo(p.sets).map((x) => ["sets/" + x.id, { ...x.doc, updatedAt: now }]), ...todo(p.kanji).map((x) => ["kanji/" + x.id, { ...x.doc, updatedAt: now }]),
        ...(p.books?.changed ? [["meta/books", { ...p.books.doc, updatedAt: now }]] : []), ...(p.courses?.changed ? [["meta/courses", p.courses.doc]] : []),
        ...(p.views?.changed ? [["meta/views", { ...p.views.doc, updatedAt: now }]] : [])];
      plan = null; render(); busy(true);
      let n = 0;
      try {
        for (const [path, doc] of jobs) { say(`Importing ${n + 1} of ${jobs.length}…`); await write(path, doc); n++; }
        const pl = (k, w) => k && `${k} ${w}${k === 1 ? "" : "s"}`;
        say(`Imported: ${[pl(count(p.sets, "new"), "new set"), pl(count(p.sets, "changed"), "updated set"), pl(todo(p.kanji).length, "kanji list"),
          p.books?.changed && "collection order", p.courses?.changed && "courses", p.views?.changed && "views"].filter(Boolean).join(", ")}.`);
      } catch (e) {
        say(`Stopped after ${n} of ${jobs.length}: ${e?.message || "the database refused the change"}. What was imported stays; import the file again to finish.`);
      }
      busy(false);
      if (n === jobs.length) done();
    }

    button.onclick = () => { input.value = ""; input.click(); };
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      say(""); plan = null; render();
      let file = null;
      try { file = JSON.parse(await f.text()); } catch {}
      if (!file) return say("That file couldn't be read. Pick a .json file made for Japanese Vocab Practice.");
      if (typeof file !== "object" || file.app !== APP || !Array.isArray(file.sets)) return say("This isn't a Japanese Vocab Practice file." + (hint && " " + hint));
      try { plan = planImport(file, f.name, await stored()); }
      catch { return say("Your vocab couldn't be read just now, so the file can't be compared with it. Reload the page and try again."); }
      render();
    };
    return me;
  }

  // The message names this page as it's served (so the beta page names itself); opened from disk, the live link stays.
  if (/^https?:$/.test(location.protocol)) $("#pageLink").textContent = location.origin + location.pathname;
  $("#copyBtn").onclick = async () => {
    const b = $("#copyBtn");
    try { await navigator.clipboard.writeText($("#askText").textContent); b.textContent = "Copied"; }
    catch { getSelection().selectAllChildren($("#askText")); b.textContent = "Selected"; } // no clipboard here: they copy it themselves
    clearTimeout(b.reset); b.reset = setTimeout(() => (b.textContent = "Copy"), 2500);
  };

  // Where this person's vocab is kept is the site's own answer (js/platform.js: their account when signed in, else this
  // browser). That file is the sign-in and the database, so it's fetched only once a file is being imported.
  let home = null, ready = null; // home: { who, db }, kept up to date if they sign in or out in another tab
  const open = () => (ready ||= new Promise((ok, no) => {
    const s = Object.assign(document.createElement("script"), { src: "../js/platform.js" });
    s.onerror = no;
    s.onload = () => { const p = window.qcardPlatform; if (!p) return no(); p.onAuth((who) => { home = { who, db: p.storeFor(who).db }; ok(); }); };
    document.head.append(s);
  }).catch((e) => { ready = null; throw e; }));
  let into = null; // where the preview on screen will be saved: the import goes there even if `home` changes meanwhile
  makeImporter({ button: $("#aiImportBtn"), input: $("#aiImportFile"), box: $("#aiImportPreview"), say: sayIn($("#aiImportMsg")),
    hint: "Ask your AI to make it the way this page says.",
    stored: async () => { $("#aiImportDone").hidden = true; await open(); into = home; return readVocab(into.db); },
    write: (path, doc) => into.db.doc(path).set(doc),
    where: () => (into.who ? `This saves to your account${into.who.email ? ` (${into.who.email})` : ""}.`
      : "You're not signed in, so this saves in this browser only. To save to an account, sign in on the site first, then import here."),
    done: () => { $("#aiImportDone").hidden = false; },
  });
})();

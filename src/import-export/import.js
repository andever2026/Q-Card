  // ---------- importing a vocab file ----------
  // The one importer, used by Settings → Import and by the AI page (ai/). It reads the file, compares it with what's
  // stored, shows a preview, and on Import writes only what's new or changed, one document at a time. Sets that aren't
  // in the file are left alone. It doesn't know where the vocab is kept; whoever makes one says how to read and write it:
  //   button, input    the "Import a file…" button and its hidden file input
  //   box, say         where the preview goes, and how a one-line message is shown (say("") clears it)
  //   stored()         the documents stored now, with their ids: { sets, kanji, books, courses } (it may be async)
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
      return { name, exportedAt: file.exportedAt, sets, kanji, books: meta(file.collections ?? file.books, here.books, cleanBooks), courses: meta(file.courses, here.courses, cleanCourses), skipped };
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
      const todo = p.sets.length - count(p.sets, "same") + p.kanji.length - count(p.kanji, "same") + (p.books?.changed ? 1 : 0) + (p.courses?.changed ? 1 : 0);
      const when = p.exportedAt && !isNaN(new Date(p.exportedAt)) ? ` · exported ${new Date(p.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "";
      box.innerHTML = `<div><b>${esc(p.name)}</b><span class="muted small">${esc(when)}</span></div>
      <ul class="small"><li>${line(p.sets, "Vocab sets")}</li><li>${line(p.kanji, "Kanji lists")}</li><li>${metaLine(p.books, "Collection order")}</li><li>${metaLine(p.courses, "Courses")}</li>
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
        ...(p.books?.changed ? [["meta/books", { ...p.books.doc, updatedAt: now }]] : []), ...(p.courses?.changed ? [["meta/courses", p.courses.doc]] : [])];
      plan = null; render(); busy(true);
      let n = 0;
      try {
        for (const [path, doc] of jobs) { say(`Importing ${n + 1} of ${jobs.length}…`); await write(path, doc); n++; }
        const pl = (k, w) => k && `${k} ${w}${k === 1 ? "" : "s"}`;
        say(`Imported: ${[pl(count(p.sets, "new"), "new set"), pl(count(p.sets, "changed"), "updated set"), pl(todo(p.kanji).length, "kanji list"),
          p.books?.changed && "collection order", p.courses?.changed && "courses"].filter(Boolean).join(", ")}.`);
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

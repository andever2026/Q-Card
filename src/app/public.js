  // ---------- public site: data files ----------
  // data/<name>.json comes as the script js/<name>.js (made by tools/build.mjs), which leaves it in window.QCardData:
  // a page opened straight from disk may load scripts, though not fetch files, so the site works offline that way too.
  function dataFile(name) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `js/${name}.js`;
      s.onload = () => { const d = window.QCardData?.[name]; if (d) delete window.QCardData[name]; s.remove(); d ? res(d) : rej(new Error(name)); };
      s.onerror = () => { s.remove(); rej(new Error(name)); };
      document.head.append(s);
    });
  }

  // ---------- public site: sample sets ----------
  // A new visitor starts with the sets in data/samples.json (written for this site, not from a textbook), so there's
  // something to practice before learning the vocab table. They're ordinary sets in their own collection. meta/samples
  // records that they were offered, so they never come back on their own once removed.
  const SAMPLE_COL = "Sample sets", isSample = (x) => colOf(x) === SAMPLE_COL;
  const sampleFile = () => dataFile("samples");
  // All at once: over a slow connection, one write after another kept a new account empty for several seconds.
  async function addSamples(file) {
    file = await (file || sampleFile());
    const now = new Date().toISOString();
    await Promise.all([...file.sets.map((d) => db.doc("sets/" + d.id).set({ ...cleanSet(d), updatedAt: now })),
      ...file.kanji.map((d) => db.doc("kanji/" + d.id).set({ ...cleanKanji(d), updatedAt: now }))]);
  }
  // For a new account (or guest): nothing but sample sets in it, if any. meta/samples is written once they're all in, so an
  // offer cut short (the page closed midway) is finished next time. While it's being decided, the picker says so (see
  // renderSetup) instead of "No vocab sets yet".
  let samplesState = ""; // "checking", "adding" or ""
  async function offerSamples() {
    samplesState = "checking";
    const file = sampleFile(); file.catch(() => {});
    try {
      if ((await db.doc("meta/samples").get()).exists) return;
      const [sets, kanji] = await Promise.all([db.collection("sets").get(), db.collection("kanji").get()]);
      const own = (snap) => snap.docs.some((d) => !d.id.startsWith("samples-"));
      if (!own(sets) && !own(kanji)) { samplesState = "adding"; renderSetup(); await addSamples(file); }
      await db.doc("meta/samples").set({ offeredAt: new Date().toISOString() });
    } catch {
      if (samplesState === "adding") banner("The sample sets couldn't be added. Reload the page to try again.");
    } finally { samplesState = ""; renderSetup(); }
  }
  let sampleAsk = false;
  function renderSampleNote() {
    const el = $("#sampleNote"), n = S.sets.filter(isSample).length;
    el.hidden = !n;
    if (!n) { sampleAsk = false; return; }
    el.innerHTML = sampleAsk
      ? `Remove the ${n} sample ${n === 1 ? "set" : "sets"} and their kanji lists? <button class="link" type="button" id="sampleYes">Remove</button> · <button class="link" type="button" id="sampleNo">Keep them</button>`
      : `The sample sets are here so you can try the page right away. Add your own in the vocab table, or import a file from Settings, whenever you're ready. <button class="link" type="button" id="sampleRemove">Remove the sample sets</button>`;
    if (!sampleAsk) { $("#sampleRemove").onclick = () => { sampleAsk = true; renderSampleNote(); }; return; }
    $("#sampleNo").onclick = () => { sampleAsk = false; renderSampleNote(); };
    $("#sampleYes").onclick = async () => {
      sampleAsk = false;
      const ids = S.sets.filter(isSample).map((x) => x.id);
      ids.forEach((id) => S.selected.delete(id)); saveSetup();
      try { for (const id of ids) await db.doc("sets/" + id).delete(); for (const k of S.kanjiLists.filter(isSample)) await db.doc("kanji/" + k.id).delete(); }
      catch { banner("Some sample sets couldn't be removed. Try again."); }
      renderSampleNote();
    };
  }

  const platform = window.qcardPlatform;

  // ---------- public site: built-in checker ----------
  // Compares the strokes with stroke templates from KanjiVG and the Hershey fonts (src/checker.js) against every accepted way of writing
  // the answer, so it only has to decide "is this one of these?", never read arbitrary writing.
  let templates = null;
  function loadTemplates() {
    templates ||= dataFile("templates")
      .then((j) => window.QCardChecker.init(j))
      .catch(() => { templates = null; throw { code: "tpl_load" }; });
    return templates;
  }
  const strokesOf = (pad) => pad.strokes.filter((s) => s.length).map((s) => s.map(([x, y]) => [x, y]));
  // Main-box answers the page would accept with no furigana (Force kanji and Katakana only rules included).
  // A 〜 the set shows stays in, and the checker lets it be written or left out (〜さん: 〜さん or さん).
  function mainCands(w) {
    const out = new Set();
    for (const p of forms(w, true)) {
      out.add(p.kana);
      if (KANJI.test(p.kanji)) for (const m of [p.kanji, learnedForm(p), ...kanjiMixes(p)]) if (m) out.add(m);
    }
    return [...out].filter((m) => m && readMatches(w, { main: m, furigana: "" }) && (S.mode !== "kata" || kataOk(w, { main: m })));
  }
  // Furigana that could sit over a kanji form: the whole reading, or the readings of some of its kanji, in order.
  function furiCands(w) {
    const out = new Set();
    for (const p of forms(w)) {
      if (!KANJI.test(p.kanji)) continue;
      out.add(hira(p.kana));
      const runs = kanjiReadings(p);
      if (runs.length <= 6) for (let m = 1; m < 1 << runs.length; m++) out.add(runs.filter((_, i) => (m >> i) & 1).join(""));
    }
    return [...out].filter(Boolean);
  }
  const nth = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  function whyNot(res) {
    const bad = (res.chars || []).map((c, i) => ({ ...c, i })).filter((c) => !c.ok), c = bad[0];
    if (!c) return "This doesn't look like the answer.";
    if (c.why === "small") return `「${c.ch}」 should be written small.`;
    if (c.why === "large") return `「${c.ch}」 should be full size.`;
    if (c.why === "missing") return `Something's missing: 「${c.ch}」.`;
    if (c.why === "extra") return "There's extra writing at the end.";
    return bad.length > 1 ? `${bad.length} characters don't match, starting with the ${nth(c.i + 1)} (「${c.ch}」).` : `The ${nth(c.i + 1)} character doesn't look like 「${c.ch}」.`;
  }
  // What the checker read, for "The checker read": each character that matched, its best guess for one that didn't
  // (？ when it has none) and nothing for a missing one.
  const readOf = (res) => (res?.chars || []).map((c) => (c.ok ? c.ch : c.why === "missing" ? "" : c.got || "？")).join("");
  // { ok, r } like Claude's verdict, or null when the answer has characters the checker has no templates for.
  async function builtinCheck(w, hasFuri) {
    await loadTemplates();
    const C = window.QCardChecker;
    const fc = hasFuri ? furiCands(w) : [];
    const fr = fc.length ? C.verify({ strokes: strokesOf(furi), candidates: fc, box: { w: furi.w, h: furi.h }, anyKana: true }) : null;
    if (fr?.ok === null) return null;
    const res = C.verify({ strokes: strokesOf(main), candidates: mainCands(w), box: { w: main.w, h: main.h }, anyKana: S.mode !== "kata" });
    if (res.ok === null) return null;
    const r = { main: res.ok ? res.text : readOf(res), furigana: !fr ? "" : fr.ok ? fr.text : readOf(fr), reason: "" };
    const chars = { main: res.chars, furi: fr?.chars };
    if (!res.ok) return { ok: false, r: { ...r, reason: whyNot(res) }, chars };
    if (hasFuri && !fc.length) return { ok: false, r: { ...r, reason: "This word has no kanji, so it needs no furigana." }, chars };
    if (fr && !fr.ok) return { ok: false, r: { ...r, reason: "The furigana doesn't match the reading of this word." }, chars };
    const ok = readMatches(w, r) && !badFuri(w, r);
    if (!ok) r.reason = "Furigana goes only over kanji you wrote, as their reading.";
    return { ok, r, chars };
  }
  // 日本語 → English: the meaning in any of the ways it may be written (englishAnswers). null when the checker can't read it.
  async function englishCheck(w) {
    await loadTemplates();
    const res = window.QCardChecker.verify({ strokes: strokesOf(main), candidates: window.QCardChecker.englishAnswers(w.en), box: { w: main.w, h: main.h }, latin: true });
    return res.ok === null ? null : { ok: res.ok, r: { main: res.ok ? res.text : readOf(res), furigana: "", reason: "" }, chars: { main: res.chars } };
  }
  // Developer tools (Settings), each off until turned on, in this browser:
  // - "Show what the checker reads as I write": a moment after each stroke, the reading the Check button would get,
  //   under the answer box, with the time the check took (it tells you before Check, so it's never on by default).
  // - "Show character boxes": a box around each character the checker found, after Check and with the live reading.
  let liveTimer = 0;
  const liveOn = () => !!store.get("liveRead", false), boxesOn = () => !!store.get("charBoxes", false);
  function showBoxes(res) {
    for (const [p, chars] of [[main, res?.chars?.main], [furi, res?.chars?.furi]]) {
      if (!boxesOn() && !p.marks) continue;
      p.marks = boxesOn() && chars ? chars.filter((c) => c.box).map((c) => ({ box: c.box, ok: c.ok, label: c.ok ? c.ch : c.got || "？" })) : null;
      p.draw();
    }
  }
  function liveRead() {
    clearTimeout(liveTimer);
    const el = $("#liveRead");
    if (!liveOn() || !Q.cur || Q.answered || Q.busy || main.empty) { el.hidden = true; return; }
    liveTimer = setTimeout(async () => {
      if (main.cur || furi.cur) return liveRead(); // not while a stroke is being drawn
      const cur = Q.cur, { w, dir } = cur;
      try {
        await loadTemplates();
        const t0 = performance.now();
        const res = dir === "je" ? await englishCheck(w) : await builtinCheck(w, dir === "ej" && !furi.empty);
        const ms = Math.round(performance.now() - t0);
        if (Q.cur !== cur || Q.answered || Q.busy || main.empty) return;
        const r = res?.r || {}, read = [r.furigana ? `furigana 「${r.furigana}」` : "", r.main ? `「${r.main}」` : ""].filter(Boolean).join(" over ");
        const verdict = !res ? "it can't check this word" : res.ok ? "would pass" : dir === "je" ? "you'd mark it yourself" : "would fail" + (r.reason ? `: ${r.reason}` : "");
        el.textContent = `Reads ${read || "nothing"} · ${verdict} · ${ms} ms`;
        el.hidden = false;
        showBoxes(res);
      } catch { el.hidden = true; }
    }, 250);
  }
  // new ink: the boxes from the last reading no longer fit it
  for (const p of [main, furi]) { const was = p.onChange; p.onChange = () => { was(); if (p.marks) { p.marks = null; p.draw(); } liveRead(); }; }
  $("#liveReadOn").checked = liveOn();
  $("#liveReadOn").onchange = (e) => { store.set("liveRead", e.target.checked); liveRead(); };
  $("#charBoxesOn").checked = boxesOn();
  $("#charBoxesOn").onchange = (e) => store.set("charBoxes", e.target.checked);
  // 日本語 → English answers the checker couldn't match (unmatched), and words it can't read, are marked by the student.
  function selfMark(unmatched) {
    const { w, dir } = Q.cur;
    $("#selfHead").textContent = unmatched ? "The checker couldn't match this to the wording below. Did you mean the same thing?" : "Compare what you wrote with the answer.";
    Q.answered = true; syncCheck();
    main.c.classList.add("locked"); furi.c.classList.add("locked");
    $("#tools").hidden = true; setErasing(false);
    if (dir === "je") $("#qSub").textContent = KANJI.test($("#qText").textContent) ? w.kana : "";
    const a = $("#selfAnswer");
    if (dir === "ej") { a.className = "answer"; a.innerHTML = w.kanji ? `<ruby>${esc(w.kanji)}<rt>${esc(w.kana)}</rt></ruby>` : esc(w.kana); }
    else { a.className = "answer en"; a.textContent = w.en; }
    $("#selfCheck").hidden = false;
    requestAnimationFrame(() => $("#selfCheck").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }));
  }
  $("#selfGot").onclick = () => { $("#selfCheck").hidden = true; grade(true, null); };
  $("#selfMiss").onclick = () => { $("#selfCheck").hidden = true; grade(false, { reason: "You marked this one as missed." }); $("#overrideBtn").hidden = true; };

  // ---------- public site: welcome / sign-in ----------
  // A first-time visitor sees a welcome pop-up over the page, which runs as a guest behind it. Once they've picked
  // anything (guest, the tour, the X, or signing in) it's remembered (qcard:welcomed) and doesn't come back, signed out
  // or not, until "Delete" starts the browser over (Annie). Signing in from Settings goes straight to Google.
  let startLocal = () => {};
  const welcomed = () => { try { localStorage.setItem("qcard:welcomed", "1"); } catch {} };
  function welcome(err) {
    $("#welcomeErr").textContent = err || ""; $("#welcomeErr").hidden = !err;
    if (!$("#welcome").open) $("#welcome").showModal();
  }
  // Closing the pop-up (its X, or Escape) is the same as continuing as a guest.
  $("#guestBtn").onclick = $("#welcomeClose").onclick = () => { try { localStorage.setItem("qcard:mode", "local"); } catch {} welcomed(); $("#welcome").close(); };
  $("#welcome").addEventListener("cancel", () => $("#welcomeClose").click());
  // Google's sign-in window; the page then reloads into the account (see boot). onErr says why it didn't work.
  async function signIn(btn, onErr) {
    btn.disabled = true;
    try { await platform.signIn(); }
    catch (e) {
      btn.disabled = false;
      if (/popup-closed-by-user|cancelled-popup-request/.test(e?.code)) return;
      onErr(e?.code === "auth/popup-blocked" ? "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again." : "Sign-in didn't work. Try again.");
    }
  }
  $("#signInBtn").onclick = () => signIn($("#signInBtn"), welcome);
  // Settings → Account and Delete. account is the signed-in person ({uid, email, name}), or null for a guest.
  let account = null, delAsk = false, stopPrefs = () => {};
  $("#settings").addEventListener("close", () => { delAsk = false; });
  function renderAccount() {
    $("#acctName").innerHTML = account ? `Signed in with Google as <b>${esc(account.email || account.name || "")}</b>.`
      : "Not signed in. As a guest, everything is kept in this browser on this device.";
    $("#signOutBtn").textContent = account ? "Sign out" : "Sign in with Google";
    $("#acctErr").hidden = true;
    $("#signOutBtn").onclick = account ? () => platform.signOut() : () => signIn($("#signOutBtn"), (m) => { $("#acctErr").textContent = m; $("#acctErr").hidden = false; });
    const what = account ? "your account and its sets, kanji lists and practice history" : "the sets, kanji lists and practice history saved in this browser";
    $("#delAcct").innerHTML = !delAsk
      ? account ? `<button class="btn danger" type="button" id="delStart">Delete my account</button>`
        : `<div class="delrow"><button class="btn danger" type="button" id="delStart" aria-describedby="delTip">Delete local storage</button>
          <span class="qtip" tabindex="0" role="button" aria-label="What this does"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2.9-1.2 1.7v.5"/><circle cx="12" cy="17.2" r=".4" fill="currentColor"/></svg><span class="qtipbody" role="tooltip" id="delTip">This deletes all local data (sets, kanji lists, practice history and settings), refreshes the page and treats you as a new user.</span></span></div>`
      : `<p class="small">This deletes ${what}, for good. Export your vocab first if you want a copy.</p>
        <div class="tactions"><button class="btn danger" type="button" id="delYes">Delete everything</button><button class="btn" type="button" id="delNo">Cancel</button></div>
        <p class="keyerr small" id="delErr" hidden></p>`;
    if (!delAsk) {
      $("#delStart").onclick = () => { delAsk = true; renderAccount(); };
      // A tap shows the tip on touch screens, where there's no hover.
      const q = $("#delAcct .qtip");
      if (q) { q.onclick = () => q.classList.toggle("open"); q.onblur = q.onmouseleave = () => q.classList.remove("open"); }
      return;
    }
    $("#delNo").onclick = () => { delAsk = false; renderAccount(); };
    $("#delYes").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Deleting…";
      stopPrefs();
      try {
        const paths = [];
        for (const c of ["sets", "kanji", "training", "data/users/" + uid]) for (const d of (await db.collection(c).get()).docs) paths.push(`${c}/${d.id}`);
        for (const p of [...paths, "meta/books", "meta/courses", "meta/samples"]) await db.doc(p).delete();
        try { localStorage.removeItem("qcard:mode"); localStorage.removeItem("qcard:welcomed"); } catch {}
        // Every choice this site kept in this browser goes too (colours, picks, a practice to resume with its writing): signed in,
        // they're the account's copy. A guest's own sets and history (qcard:local:…) stay unless it's the guest being deleted.
        try { for (const k of Object.keys(localStorage)) if (k.startsWith("jpq:") || (!account && k.startsWith("qcard:"))) localStorage.removeItem(k); } catch {}
        if (account) await platform.deleteAccount(); // which signs out, and the page starts over (see boot)
        else location.reload(); // a guest starts over as a new visitor
      } catch (err) {
        e.target.disabled = false; e.target.textContent = "Delete everything";
        $("#delErr").hidden = false;
        $("#delErr").textContent = err?.code === "auth/popup-blocked" ? "Your data is deleted. To delete the account itself, allow pop-ups for this site so Google can confirm it's you, then try again."
          : "Something went wrong. Try again.";
      }
    };
  }

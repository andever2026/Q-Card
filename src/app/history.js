  // ---------- history ----------
  S.history = []; S.hOpen = new Set(); S.hConfirm = null; S.toughIds = [];
  // Test history is opt-in: data/users/<id>/settings {history: true|false}; missing = not asked yet.
  S.histOn = null; S.histReady = false; S.histBlocked = false;
  // The owner's history lives in the database (the morning check-in reads it). Everyone else's stays in their own
  // browser (S.local): only that device has it, and clearing site data or a private window loses it.
  S.local = false;
  const LOCAL_MAX = 300; // sessions kept in the browser; the oldest go first
  function loadLocal() {
    const v = store.get("histOn", null);
    S.histOn = typeof v === "boolean" ? v : null; S.histReady = true;
    S.history = (store.get("hist", []) || []).filter((t) => t && /^t\d/.test(t.id)).sort((a, b) => String(b.finishedAt || "").localeCompare(String(a.finishedAt || "")));
    renderRecent();
    if (!$("#history").hidden) renderHistory();
  }
  function saveLocal(list) {
    if (!store.set("hist", list.slice(0, LOCAL_MAX))) banner("This browser couldn't save that practice session.");
    loadLocal();
  }
  function watchLocal() {
    S.local = true;
    loadLocal();
    addEventListener("storage", (e) => { if (e.key === "jpq:hist" || e.key === "jpq:histOn") loadLocal(); }); // another tab
  }
  const settingsDoc = () => db.doc(`data/users/${uid}/settings`);
  async function setHistory(on) {
    if (S.local) {
      // A private window or blocked site data can refuse even this.
      if (store.set("histOn", on)) { S.histOn = on; return true; }
      S.histBlocked = true; renderRecent(); if (!$("#history").hidden) renderHistory();
      return false;
    }
    try { await settingsDoc().set({ history: on, updatedAt: new Date().toISOString() }); S.histOn = on; return true; }
    catch (e) {
      // View-only visitors (including anyone outside the owner's organization) can't write their own subtree.
      if (e?.code === "invalid_argument") { S.histBlocked = true; renderRecent(); if (!$("#history").hidden) renderHistory(); }
      else banner("Couldn't save that choice. Try again.");
      return false;
    }
  }
  const DIRS = { ej: "English → 日本語", je: "日本語 → English", both: "Both directions" };
  const MODES = { default: "Default", kanji: "Force kanji", kana: "Kana only", kata: "Katakana only", verb: "Verb forms" };
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const firstTry = (t) => { const ws = t.words || []; return { n: ws.length, first: ws.filter((w) => w.tries === 1).length }; };

  // On load the account's copy of the choices replaces this browser's (a first sign-in saves this browser's instead),
  // and each later change is saved back shortly after it's made. Returns a function that stops the saving.
  function syncPrefs() {
    const ref = db.doc(`data/users/${uid}/prefs`);
    let first = true, timer = null, stopped = false;
    const save = () => {
      clearTimeout(timer); timer = null;
      if (stopped) return;
      const p = Object.fromEntries(PREF_KEYS.map((k) => [k, store.get(k, null)]).filter(([, v]) => v != null));
      Promise.resolve().then(() => ref.set({ ...p, updatedAt: new Date().toISOString() })).catch(() => {});
    };
    const off = ref.onSnapshot((snap) => {
      if (!first) return;
      first = false; setTimeout(() => typeof off === "function" && off(), 0);
      if (snap.exists) usePrefs(snap.data() || {}); else save();
      prefsChanged = () => { clearTimeout(timer); timer = setTimeout(save, 800); };
      const flush = () => { if (timer) save(); };
      addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    }, () => {});
    return () => { stopped = true; clearTimeout(timer); prefsChanged = () => {}; };
  }
  function usePrefs(p) {
    // A practice to resume is the account's, or none: one left in this browser may be from another account or already finished elsewhere.
    for (const k of PREF_KEYS) if (p[k] != null || k === "resume") store.set(k, p[k] ?? null);
    S.selected = new Set(store.get("selected", []));
    Object.assign(S.pick, { show: store.get("bookShow", null), picks: new Set(store.get("pickChs", [])) });
    Object.assign(S.tpick, { show: store.get("tShow", null), picks: new Set(store.get("tChs", [])) });
    S.groupBy = store.get("groupBy", "book");
    S.pickTags = new Set(store.get("pickTags", []));
    S.dir = store.get("dir", "ej"); S.mode = store.get("mode", "default"); S.upto = store.get("uptoPick", "auto");
    S.loveWin = String(store.get("loveWin", "all"));
    setPalette(store.get("palette", "indigo"));
    //#if public
    setTheme(store.get("theme", ""));
    //#endif
    renderSetup(); renderTable();
  }

  function watchHistory() {
    if (!db || !uid) return;
    settingsDoc().onSnapshot((snap) => {
      const v = snap.exists ? snap.data().history : undefined;
      S.histOn = typeof v === "boolean" ? v : null; S.histReady = true;
      renderRecent();
      if (!$("#history").hidden) renderHistory();
    }, () => {});
    db.collection("data/users/" + uid).orderBy("finishedAt", "desc").limit(1000).onSnapshot((snap) => {
      S.history = snap.docs.filter((d) => /^t\d/.test(d.id)).map((d) => ({ id: d.id, ...d.data() }));
      renderRecent();
      if (!$("#history").hidden) renderHistory();
    }, () => {});
  }
  function renderRecent() {
    const h = S.history, on = S.histOn, ask = $("#histAsk");
    $("#histPanel").hidden = !S.histReady;
    $("#histAll").hidden = !h.length;
    $("#histAll").textContent = `See all ${h.length} →`;
    $("#histOff").hidden = on !== true;
    $("#histTitle").textContent = on === true && h.length ? "Your recent practice" : "Practice history";
    const earlier = h.length ? `<p class="muted small">${h.length} earlier practice session${h.length === 1 ? " is" : "s are"} still saved. Open “See all” to look at or delete ${h.length === 1 ? "it" : "them"}.</p>` : "";
    ask.hidden = on === true && h.length > 0;
    ask.innerHTML = S.histBlocked
      ? `<p class="muted">${S.local ? "This browser isn't letting the page save anything (a private window or blocked site data), so practice history is off." : "Your access to this page doesn't allow saving practice history."} You can still practice as much as you like.</p>`
      : on === null
      ? `<p>Turn on data collection? Each finished practice session would be saved so you can see fun stats about your practice, like graphs, streaks and the words that need more work. ${S.local
          ? "It's saved only in this browser on this device, so nobody else can see it. Clearing your browser data removes it, and you can delete it here at any time."
          : "Only you and the site maintainers can see this data, and you can delete it from the server at any time."}</p>${earlier}
         <div class="tactions"><button class="btn primary" data-hist="on">Turn on data collection</button><button class="btn" data-hist="off">No thanks</button></div>`
      : on === false
      ? `<p class="muted">Data collection is off, so finished sessions aren't saved.</p>${earlier}<div class="tactions"><button class="btn" data-hist="on">Turn on data collection</button></div>`
      : `<p class="muted">Data collection is on. Finish a practice session and it shows up here.</p>`;
    ask.querySelectorAll("[data-hist]").forEach((b) => (b.onclick = async () => { b.disabled = true; if (await setHistory(b.dataset.hist === "on")) renderRecent(); else b.disabled = false; }));
    $("#histList").hidden = on !== true || !h.length;
    $("#histList").innerHTML = on !== true ? "" : h.slice(0, 5).map((t) => {
      const { n, first } = firstTry(t);
      return `<li><span>${esc((t.sets || []).join(", "))}</span><span>${esc(fmtWhen(t.finishedAt))} · ${first}/${n} first try</span></li>`;
    }).join("");
  }
  $("#histAll").onclick = () => { S.hConfirm = null; show("history"); renderHistory(); };
  $("#histOff").onclick = async () => { if (await setHistory(false)) renderRecent(); };
  $("#histBack").onclick = () => show("setup");

  function renderHistory() {
    const h = S.history;
    $("#hEmpty").hidden = !!h.length; $("#hBody").hidden = !h.length; $("#hStats").hidden = !h.length;
    if (!h.length) {
      $("#hEmpty").innerHTML = S.histOn === true ? `<b>No finished practice sessions yet.</b><span>Finish a practice session and it shows up here.</span>`
        : S.histBlocked ? `<b>Practice history isn't available.</b><span>${S.local ? "This browser isn't letting the page save it." : "Your access to this page doesn't allow saving it."}</span>`
        : `<b>Data collection is off.</b><span>Finished sessions aren't saved.</span><span><button class="btn" id="hTurnOn">Turn on data collection</button></span>`;
      const b = $("#hTurnOn"); if (b) b.onclick = async () => { b.disabled = true; if (await setHistory(true)) { renderRecent(); renderHistory(); } else b.disabled = false; };
      return;
    }
    const days = new Set(h.map((t) => dayKey(new Date(t.finishedAt))));
    let streak = 0; const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    $("#hTests").textContent = h.length;
    $("#hWords").textContent = h.reduce((a, t) => a + (t.words || []).length, 0);
    $("#hStreak").textContent = streak;
    drawHeat(); drawAcc(); renderToughest(); renderTests(); if (!deletingAll && !$("#delAllYes")) renderDelAll();
  }

  const tip = $("#tip");
  function showTip(text, x, y) {
    tip.textContent = text; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 12)) + "px";
    tip.style.top = Math.max(8, y - r.height - 12) + "px";
  }
  const hideTip = () => (tip.hidden = true);

  function drawHeat() {
    const counts = new Map();
    for (const t of S.history) { const k = dayKey(new Date(t.finishedAt)); counts.set(k, (counts.get(k) || 0) + 1); }
    // Like GitHub's graph: squares stay one size and the graph shows as many weeks as fit (up to a year).
    const c = 14, g = 3, left = 28, top = 16, scale = 1.1, avail = $("#heat").clientWidth;
    const weeks = avail ? Math.max(8, Math.min(53, Math.floor((avail / scale - left) / (c + g)))) : 16;
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
    let cells = "", months = "", lastM = -1, lastX = -99;
    for (let wk = 0; wk < weeks; wk++) for (let dow = 0; dow < 7; dow++) {
      const day = new Date(start); day.setDate(start.getDate() + wk * 7 + dow);
      if (day > end) continue;
      const n = counts.get(dayKey(day)) || 0, lv = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4;
      const x = left + wk * (c + g), y = top + dow * (c + g);
      const label = `${day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${n} session${n === 1 ? "" : "s"}`;
      cells += `<rect class="h${lv}" x="${x}" y="${y}" width="${c}" height="${c}" rx="3" data-tip="${esc(label)}"></rect>`;
      if (dow === 0 && day.getMonth() !== lastM && wk < weeks - 1 && x - lastX >= 3 * (c + g)) { lastM = day.getMonth(); lastX = x; months += `<text class="ax" x="${x}" y="10">${day.toLocaleDateString(undefined, { month: "short" })}</text>`; }
    }
    const W = left + weeks * (c + g), H = top + 7 * (c + g);
    $("#heatTitle").textContent = `Practice sessions per day, last ${weeks} weeks`;
    const wd = [[1, "Mon"], [3, "Wed"], [5, "Fri"]].map(([i, l]) => `<text class="ax" x="0" y="${top + i * (c + g) + c - 3}">${l}</text>`).join("");
    $("#heat").innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:${Math.round(W * scale)}px;max-width:100%;height:auto;display:block" role="img" aria-label="Practice sessions per day over the last ${weeks} weeks">${months}${wd}${cells}</svg>`;
  }
  $("#heat").addEventListener("pointermove", (e) => { const t = e.target.closest("[data-tip]"); t ? showTip(t.dataset.tip, e.clientX, e.clientY) : hideTip(); });
  $("#heat").addEventListener("pointerleave", hideTip);
  let heatW = 0;
  new ResizeObserver(() => { const w = Math.round($("#heat").clientWidth); if (w && w !== heatW && !$("#history").hidden) { heatW = w; drawHeat(); } }).observe($("#heat"));

  function drawAcc() {
    const box = $("#acc");
    const pts = S.history.slice(0, 30).reverse().map((t) => { const { n, first } = firstTry(t); return { t, n, first, v: n ? first / n : 0 }; });
    if (pts.length < 2) { box.innerHTML = `<p class="muted small">Finish one more practice session to start the trend line.</p>`; return; }
    const W = Math.max(280, Math.round(box.clientWidth)), H = 180, L = 40, R = 14, T = 12, B = 26;
    const x = (i) => L + (i * (W - L - R)) / (pts.length - 1), y = (v) => T + (1 - v) * (H - T - B);
    const grid = [0, 0.5, 1].map((v) => `<line class="gridln" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"></line><text class="ax" x="${L - 8}" y="${y(v) + 3.5}" text-anchor="end">${v * 100}%</text>`).join("");
    const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
    const dots = pts.map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4"></circle>`).join("");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block" role="img" aria-label="First-try score for your last ${pts.length} practice sessions">${grid}
      <text class="ax" x="${L}" y="${H - 6}">${esc(fmtDay(pts[0].t.finishedAt))}</text><text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(fmtDay(pts[pts.length - 1].t.finishedAt))}</text>
      <line class="cross" y1="${T}" y2="${H - B}" hidden></line><path class="ln" d="${path}"></path>${dots}</svg>`;
    const svg = box.querySelector("svg"), cross = svg.querySelector(".cross"), dotEls = svg.querySelectorAll(".dot");
    svg.onpointermove = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1)))), p = pts[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.removeAttribute("hidden");
      dotEls.forEach((d, j) => d.classList.toggle("on", j === i));
      showTip(`${fmtWhen(p.t.finishedAt)} · ${(p.t.sets || []).join(", ")} · ${p.first}/${p.n} first try (${Math.round(p.v * 100)}%)`, e.clientX, e.clientY);
    };
    svg.onpointerleave = () => { cross.setAttribute("hidden", ""); dotEls.forEach((d) => d.classList.remove("on")); hideTip(); };
  }
  let accW = 0;
  new ResizeObserver(() => { const w = Math.round($("#acc").clientWidth); if (w && w !== accW && !$("#history").hidden && S.history.length) { accW = w; drawAcc(); } }).observe($("#acc"));

  // A word leaves the list after CLEAR_RUN sessions in a row where it was right on the first try; a miss resets the run,
  // and a word that comes back keeps its old miss count.
  const CLEAR_RUN = 3;
  function renderToughest() {
    const agg = new Map();
    // Oldest session first, so each word's run counts the sessions since its latest miss.
    const byTime = S.history.slice().sort((a, b) => String(a.finishedAt || "").localeCompare(String(b.finishedAt || "")));
    const win = S.loveWin === "all" ? Infinity : +S.loveWin;
    document.querySelectorAll("#loveWin [data-win]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.win === S.loveWin));
    for (const [ti, t] of byTime.entries()) for (const w of t.words || []) {
      if (w.skip) continue; // left off the list on the results page
      const k = w.id + ":" + w.dir, a = agg.get(k) || { w, misses: 0, tests: 0, run: 0 };
      const miss = Math.max(0, (w.tries || 1) - 1);
      // Misses count only inside the chosen window of recent sessions; the clearing run always looks at everything.
      if (byTime.length - ti <= win) { a.misses += miss; a.tests++; }
      a.run = miss ? 0 : a.run + 1; a.w = w; a.ever = (a.ever || 0) + miss; agg.set(k, a);
    }
    const top = [...agg.values()].filter((a) => a.misses && a.run < CLEAR_RUN).sort((a, b) => b.misses - a.misses || b.tests - a.tests).slice(0, 10);
    // The panel stays while any word is still on the list, so the window can be widened again.
    $("#hLovePanel").hidden = ![...agg.values()].some((a) => a.ever && a.run < CLEAR_RUN);
    S.toughIds = top.map((a) => a.w.id);
    const live = new Set(S.sets.flatMap((s) => s.words.map((w) => w.id)));
    $("#hPractise").hidden = !S.toughIds.some((id) => live.has(id));
    $("#hLove").innerHTML = top.map((a) => `<li><span class="tries">${a.misses}</span><div><div class="w">${esc(a.w.jp)}<small>${esc(a.w.en)}${a.w.dir === "je" ? " · JP→EN" : ""}</small></div><p>Missed ${a.misses} time${a.misses === 1 ? "" : "s"} across ${win >= byTime.length ? `all ${byTime.length} session${byTime.length === 1 ? "" : "s"}` : `the last ${win} sessions`}.${a.run ? ` <span class="toclear">${a.run} of ${CLEAR_RUN} first tries in a row to clear</span>` : ""}</p></div></li>`).join("") || `<li class="none"><p>No misses in the last ${win} sessions.</p></li>`;
  }
  S.loveWin = String(store.get("loveWin", "all"));
  if (!["5", "10", "20", "50", "all"].includes(S.loveWin)) S.loveWin = "all";
  $("#loveWin").onclick = (e) => { const b = e.target.closest("[data-win]"); if (!b) return; S.loveWin = b.dataset.win; store.set("loveWin", S.loveWin); renderToughest(); };
  $("#hPractise").onclick = () => {
    const ids = new Set(S.toughIds), words = [];
    for (const s of S.sets) for (const w of s.words) if (ids.has(w.id) && (w.en || "").trim() && (w.kana || w.kanji)) words.push({ ...w, set: setName(s) });
    if (words.length) startTest(words);
  };

  function renderTests() {
    const shown = S.history.slice(0, S.hShown || 20);
    $("#hMore").hidden = shown.length >= S.history.length;
    $("#hMore").textContent = `Show ${Math.min(20, S.history.length - shown.length)} more`;
    $("#hList").innerHTML = shown.map((t) => {
      const { n, first } = firstTry(t), del = S.hConfirm === t.id;
      const ws = (t.words || []).slice().sort((a, b) => b.tries - a.tries);
      return `<li class="test"><details data-id="${esc(t.id)}" ${S.hOpen.has(t.id) ? "open" : ""}><summary><span class="when">${esc(fmtWhen(t.finishedAt))}</span><span class="what">${esc((t.sets || []).join(", "))}</span><span class="score">${first}/${n} first try</span></summary>
        <p class="muted small">${esc(DIRS[t.dir] || "")} · ${esc(MODES[t.mode] || "Default")}</p>
        <p class="tw">${ws.map((w) => `<span class="${w.tries > 1 ? "miss" : ""}" title="${esc(w.en)}">${esc(w.jp)}${w.tries > 1 ? ` ×${w.tries}` : ""}</span>`).join("")}</p>
        <div class="tactions">${del ? `<span class="small">Delete this session?</span><button class="btn danger" data-hdel-yes="${esc(t.id)}">Delete</button><button class="btn" data-hdel-no>Keep</button>` : `<button class="ghost small" data-hdel="${esc(t.id)}">Delete this session</button>`}</div>
      </details></li>`;
    }).join("");
  }
  $("#hMore").onclick = () => { S.hShown = (S.hShown || 20) + 20; renderTests(); };
  $("#hList").addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.id) d.open ? S.hOpen.add(d.dataset.id) : S.hOpen.delete(d.dataset.id); }, true);
  $("#hList").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.hdel) { S.hConfirm = b.dataset.hdel; renderTests(); }
    else if ("hdelNo" in b.dataset) { S.hConfirm = null; renderTests(); }
    else if (b.dataset.hdelYes) {
      S.hConfirm = null; b.disabled = true; b.textContent = "Deleting…";
      if (S.local) { saveLocal(S.history.filter((t) => t.id !== b.dataset.hdelYes)); return; }
      try { await db.doc(`data/users/${uid}/${b.dataset.hdelYes}`).delete(); } catch { banner("Couldn't delete that session. Try again."); renderTests(); }
    }
  });
  function renderDelAll(state) {
    const w = $("#delAllWrap");
    if (state === "confirm") w.innerHTML = `<span class="small">Delete all ${S.history.length} practice sessions and stop saving new ones? This can't be undone.</span><button class="btn danger" id="delAllYes">Delete all and turn off</button><button class="btn" id="delAllNo">Keep</button>`;
    else if (state) w.innerHTML = `<span class="small muted">${esc(state)}</span>`;
    else w.innerHTML = `<button class="ghost small" id="delAll">Delete all history and turn off data collection</button>`;
  }
  let deletingAll = false;
  $("#delAllWrap").addEventListener("click", async (e) => {
    const id = e.target.id;
    if (id === "delAll") renderDelAll("confirm");
    else if (id === "delAllNo") renderDelAll();
    else if (id === "delAllYes" && !deletingAll) {
      deletingAll = true;
      if (!(await setHistory(false))) { deletingAll = false; renderDelAll(); return; } // stop saving before deleting
      if (S.local) { deletingAll = false; saveLocal([]); renderDelAll(); return; }
      const ids = S.history.map((t) => t.id);
      for (let i = 0; i < ids.length; i++) {
        renderDelAll(`Deleting ${i + 1} of ${ids.length}…`);
        try { await db.doc(`data/users/${uid}/${ids[i]}`).delete(); } catch { banner("Some sessions couldn't be deleted. Try again."); break; }
      }
      deletingAll = false; renderDelAll();
    }
  });

  // ---------- public site: the tour ----------
  // "First time here? Take the 5-minute tour" in the welcome pop-up: a guided first practice as a guest. Each step rings
  // part of the page (the rest is dimmed but still works) and says what it's for. A step with `done` waits for the
  // visitor to do it, and Next does it for them (`act`); a step whose part isn't on the page is skipped (after `grace` ms,
  // for a part that may still be loading).
  const vis = (el) => !!el && el.getClientRects().length > 0;
  const firstVis = (...sels) => sels.map((s) => $(s)).find(vis) || null;
  const TOUR = [
    { title: "Welcome to the tour", next: "Start the tour",
      text: "In about 5 minutes you'll practice a word with the sample sets and see where everything is. You're using the page as a guest for now. Leave any time with the ✕." },
    { view: "setup", at: () => $("#setPicker [data-set]:not(:disabled)"), title: "Pick a set", grace: 2000,
      text: "These are your vocab sets, grouped Collection › Unit › Set. The sample sets are here to try. Tap a set to pick it (you can pick more than one).",
      done: () => S.selected.size > 0, act: () => $("#setPicker [data-set]:not(:disabled)")?.click() },
    { view: "setup", at: () => firstVis("#pickBar"), title: "Units and filters",
      text: "These chips show or hide whole units. When sets have tags, a Filter row narrows them down too." },
    { view: "setup", at: () => $("#dirSeg"), title: "Direction",
      text: "English → 日本語 shows the English and you write the Japanese. 日本語 → English is the other way round, and Both mixes them. We'll use English → 日本語.",
      leave: () => { if (S.dir !== "ej") $("#dir-ej").click(); } },
    { view: "setup", at: () => $("#modeSeg"), title: "Modes",
      text: "Modes change what you're asked: Kana only, Force kanji (the kanji you've learned), Katakana only, or Verb forms (five forms of each verb). Default takes any correct mix of kana and kanji.",
      leave: () => { if (S.mode !== "default") $("#mode-default").click(); } },
    { view: "setup", at: () => firstVis(".uptorow"), title: "Kanji learned up to",
      text: "Tell the page how far you've got with kanji. It goes by your kanji lists to decide what Force kanji asks for and how 日本語 → English questions are shown." },
    { view: "setup", at: () => $("#startBtn"), title: "Start practicing", text: "Tap Start practice.",
      done: () => vis($("#quiz")), act: () => $("#startBtn").click() },
    { view: "quiz", at: () => $("#quiz .prompt"), title: "The question",
      text: "Each card shows the set the word comes from and its English. You write the Japanese below." },
    { view: "quiz", at: () => $("#mainPad"), title: "The answer box",
      text: "Write here with a finger, a stylus or the mouse. Neatness and stroke order don't matter." },
    { view: "quiz", at: () => $("#furiPad"), title: "Furigana",
      text: "Wrote kanji? You can add its reading in this thin strip above it. It's optional." },
    { view: "quiz", at: () => $("#tools .itools"), title: "Writing tools",
      text: "Undo takes back the last stroke (Ctrl+Z works too), the bin clears everything, and the switch turns the pen into an eraser that removes whole strokes." },
    { view: "quiz", id: "write", at: () => [$("#quiz .sheet"), $("#tools")], title: "Your turn", next: "Check",
      text: "Write the answer, then tap Check. Not sure? Write your best guess: you'll see the answer either way.",
      done: () => tour.checked && !vis($("#checking")), ready: () => !$("#checkBtn").disabled, act: () => $("#checkBtn").click(), skip: "quit" },
    { view: "quiz", at: () => firstVis("#selfCheck", "#feedback", "#quiz .prompt"), title: "The result",
      text: "A right answer gets a 花丸 and the next word comes up by itself. Otherwise you see the answer and a scratch pad to practice it. When the checker can't read your writing you mark it yourself, and if it misreads a right answer you can count it as correct." },
    { view: "quiz", at: () => firstVis("#scratchPad"), title: "Scratch pad",
      text: "Practice the right answer here as many times as you like. It isn't marked." },
    { view: "quiz", id: "quit", at: () => $("#quitBtn"), title: "Stop any time",
      text: "Next word → moves on, and you can also leave midway. Tap ← Quit now.",
      done: () => vis($("#setup")), act: () => $("#quitBtn").click() },
    { view: "setup", at: () => firstVis("#resumeBtn"), title: "Pick up where you left off",
      text: "Because you left midway, Resume last practice carries on where you stopped, even with what you'd written. Start practice begins a new one." },
    { view: "setup", at: () => firstVis("#histPanel"), title: "Your practice",
      text: "Your recent practice shows up here. Turn on history to see your progress and which words need the most love." },
    { view: "setup", at: () => $("#toTable"), title: "The vocab table", text: "Tap vocab table to see the words in every set.",
      done: () => vis($("#table")), act: () => $("#toTable").click() },
    { view: "table", at: () => firstVis("#setTables"), title: "Your sets",
      text: "Open a set to see its words. You can edit them, and the set's details and tags." },
    { view: "table", at: () => firstVis("#newSetForm"), title: "Add your own sets",
      text: "Give a new set its collection (a textbook or course), its unit (like Ch. 3 or Week 1) and a name, then type in the words. You can also import a file from Settings." },
    { view: "table", at: () => firstVis("#kanjiLists")?.closest(".panel"), title: "Kanji lists",
      text: "One list per unit with the kanji it teaches. Kanji learned up to counts these." },
    { view: "table", at: () => $("#backBtn"), title: "Back to practice", text: "Tap ← Back to practice.",
      done: () => vis($("#setup")), act: () => $("#backBtn").click() },
    { view: "setup", at: () => $("#settingsBtn"), title: "Settings",
      text: "The gear opens Settings: colours, light or dark, your account, export / import, and deleting your data." },
    { title: "That's the tour!", end: true,
      text: "You're a guest right now, so everything stays in this browser. Sign in with Google to keep your sets and history on all your devices." },
  ];
  const tour = { i: -1, on: false, checked: false, doneAtStart: false, since: 0, frame: 0, card: null, spot: null };
  const tourEls = (st) => { const a = st?.at?.(); return (Array.isArray(a) ? a : [a]).filter(vis); };

  function startTour() {
    if (!tour.card) {
      tour.spot = document.createElement("div"); tour.spot.className = "tourspot";
      tour.card = document.createElement("div"); tour.card.className = "tourcard"; tour.card.setAttribute("role", "dialog"); tour.card.setAttribute("aria-label", "Tour");
      document.body.append(tour.spot, tour.card);
      // Check is how "Your turn" ends; the capture phase sees the click before the page handles it.
      $("#checkBtn").addEventListener("click", () => { if (tour.on) tour.checked = true; }, true);
    }
    tour.on = true; tour.spot.hidden = tour.card.hidden = false;
    goStep(0);
    cancelAnimationFrame(tour.frame); tour.frame = requestAnimationFrame(tourTick);
  }
  function endTour() {
    tour.on = false; tour.i = -1; cancelAnimationFrame(tour.frame);
    tour.spot.hidden = tour.card.hidden = true;
  }
  function goStep(i, dir = 1) {
    TOUR[tour.i]?.leave?.();
    while (TOUR[i]?.at && !TOUR[i].grace && !tourEls(TOUR[i]).length && TOUR[i + dir]) i += dir;
    tour.i = i; tour.since = performance.now(); tour.checked = false;
    // A step that's already done when it starts (a set was picked before) just explains; it doesn't race on.
    tour.doneAtStart = !!TOUR[i].done?.();
    renderTourCard();
    const els = tourEls(TOUR[i]);
    if (!els.length) return;
    // Centred, unless that leaves no room above or below it for the card (a short phone screen): then near the top, card under it.
    const rs = els.map((e) => e.getBoundingClientRect()), top = Math.min(...rs.map((r) => r.top)), h = Math.max(...rs.map((r) => r.bottom)) - top;
    if ((innerHeight - h) / 2 >= tour.card.offsetHeight + 26) els[0].scrollIntoView({ block: "center", behavior: "smooth" });
    else scrollBy({ top: top - 16, behavior: "smooth" });
  }
  const stepIndex = (id) => TOUR.findIndex((s) => s.id === id);
  // The steps Back can return to: earlier ones on the same page that don't wait for anything.
  function backIndex() {
    const st = TOUR[tour.i];
    if (st.done) return -1;
    for (let j = tour.i - 1; j > 0; j--) { const p = TOUR[j]; if (p.view !== st.view || p.done) return -1; if (tourEls(p).length) return j; }
    return -1;
  }
  function renderTourCard() {
    const st = TOUR[tour.i], n = TOUR.length;
    const back = backIndex() >= 0 ? `<button class="ghost" type="button" data-tour="back">Back</button>` : "";
    const btns = st.end
      ? `<button class="btn" type="button" data-tour="close">Keep going as a guest</button><button class="btn primary" type="button" data-tour="signin">Sign in with Google</button>`
      : `${st.skip ? `<button class="link" type="button" data-tour="skip">Skip this</button>` : ""}${back}<button class="btn primary" type="button" data-tour="next">${st.next || "Next"}</button>`;
    tour.card.innerHTML = `<div class="tourhead"><span class="muted small">${tour.i + 1} of ${n}</span>
        <button class="dlgx" type="button" data-tour="close" aria-label="End the tour" title="End the tour"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div>
      <p class="tourtitle">${esc(st.title)}</p><p>${esc(st.text)}</p><div class="tourbtns">${btns}</div>`;
    tour.card.querySelectorAll("[data-tour]").forEach((b) => (b.onclick = () => tourButton(b.dataset.tour)));
    syncTourNext();
  }
  function syncTourNext() {
    const b = tour.card.querySelector('[data-tour="next"]'), st = TOUR[tour.i];
    if (b) b.disabled = !!st.ready && !st.ready();
  }
  function tourButton(what) {
    const st = TOUR[tour.i];
    if (what === "close") return endTour();
    if (what === "signin") { endTour(); return signIn(tour.card.querySelector('[data-tour="signin"]'), banner); }
    if (what === "back") return goStep(backIndex(), -1);
    if (what === "skip") return goStep(stepIndex(st.skip));
    if (st.done && !st.done()) { st.act?.(); if (st.id !== "write") return nextTourStep(); return; }
    nextTourStep();
  }
  function nextTourStep() {
    if (tour.i < TOUR.length - 1) goStep(tour.i + 1);
  }
  // Every frame: follow the ringed part as the page moves, move on once a waiting step is done, and skip a step whose
  // part hasn't shown up within a moment (sets still loading get that moment too).
  function tourTick(now) {
    if (!tour.on) return;
    tour.frame = requestAnimationFrame(tourTick);
    const st = TOUR[tour.i], els = tourEls(st);
    if (st.done && !tour.doneAtStart && st.done() && now - tour.since > 300) return nextTourStep();
    if (st.at && !els.length && now - tour.since > (st.grace || 300)) return nextTourStep();
    syncTourNext();
    placeTour(els);
  }
  function placeTour(els) {
    const vw = innerWidth, vh = innerHeight, card = tour.card, w = card.offsetWidth, h = card.offsetHeight, s = tour.spot.style;
    if (!els.length) {
      Object.assign(s, { top: vh / 2 + "px", left: vw / 2 + "px", width: "0px", height: "0px" });
      tour.spot.classList.add("none");
      Object.assign(card.style, { top: Math.max(12, (vh - h) / 2) + "px", left: Math.max(12, (vw - w) / 2) + "px" });
      return;
    }
    tour.spot.classList.remove("none");
    const rs = els.map((e) => e.getBoundingClientRect()), pad = 6;
    const r = { top: Math.min(...rs.map((x) => x.top)) - pad, left: Math.min(...rs.map((x) => x.left)) - pad,
      bottom: Math.max(...rs.map((x) => x.bottom)) + pad, right: Math.max(...rs.map((x) => x.right)) + pad };
    Object.assign(s, { top: r.top + "px", left: r.left + "px", width: r.right - r.left + "px", height: r.bottom - r.top + "px" });
    // Below the ringed part if it fits, else above, else at the bottom of the screen.
    const top = vh - r.bottom >= h + 20 ? r.bottom + 10 : r.top >= h + 20 ? r.top - h - 10 : vh - h - 12;
    const left = Math.min(Math.max(12, (r.left + r.right) / 2 - w / 2), vw - w - 12);
    Object.assign(card.style, { top: top + "px", left: left + "px" });
  }
  document.addEventListener("keydown", (e) => { if (tour.on && e.key === "Escape" && !document.querySelector("dialog[open]")) endTour(); });
  $("#tourBtn").onclick = () => { $("#guestBtn").click(); startTour(); };

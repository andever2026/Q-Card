  // ---------- reports of shared notebooks, for developers (public site) ----------
  // Settings → Admin lists the reports people sent (report.js), newest first, by notebook. Take down makes
  // takedowns/<id>: from then on only the notebook's owner and developers can open its link, and people who added the
  // notebook keep what they have, and it leaves the Browse page (its owner can't list it while it's down). Put back deletes it again. Dismiss deletes the reports. Who may do any of this is
  // checked by firestore.rules (dev/<uid>), not here: for anyone else the list stays empty and the buttons fail.
  let repSeq = 0;
  async function renderReports() {
    const box = $("#repList"), seq = ++repSeq;
    $("#repCount").textContent = "";
    if (!isDev) { box.innerHTML = ""; return; }
    box.innerHTML = `<p class="muted small">Loading…</p>`;
    const by = new Map(), at = (id) => by.get(id) || by.set(id, { id, reports: [] }).get(id);
    try {
      const [reports, downs] = await Promise.all([platform.reports.orderBy("at", "desc").limit(200).get(), platform.takedowns.get()]);
      for (const d of reports.docs) { const r = d.data(); if (SHARE_RE.test(r.share)) at(r.share).reports.push({ id: d.id, why: REPORT_WHY[r.why] ? r.why : "other", note: tidy(r.note, 1000), at: r.at }); }
      for (const d of downs.docs) if (SHARE_RE.test(d.id)) at(d.id).down = true;
      await Promise.all([...by.values()].map(async (g) => { g.name = dataOrNull(await platform.shared(g.id).info.get())?.name; }));
    } catch { if (seq === repSeq) box.innerHTML = `<p class="muted small">Couldn't load the reports. Check your connection, then press Refresh.</p>`; return; }
    if (seq !== repSeq) return;
    const n = [...by.values()].reduce((n, g) => n + g.reports.length, 0);
    $("#repCount").textContent = n ? ` (${n})` : "";
    box.innerHTML = !by.size ? `<p class="muted small">No reports.</p>` : [...by.values()].map((g) => `<div class="rep" data-rep="${g.id}">
      <div class="rephead">${g.name == null ? `<b>No longer shared</b>` : `<a href="#shared/${g.id}"><b>${esc(tidy(g.name, 60) || NB_NAME)}</b></a>`}<span class="muted small">${[plural(g.reports.length, "report"), ...(g.down ? ["Taken down"] : [])].join(" · ")}</span></div>
      ${g.reports.length ? `<ul>${g.reports.map((r) => `<li><span class="muted small">${[isNaN(new Date(r.at)) ? "" : dayText(r.at), r.why === "copyright" ? "Copyright" : "Something else"].filter(Boolean).join(" · ")}</span>${r.note ? ` ${esc(r.note)}` : ""}</li>`).join("")}</ul>` : ""}
      <div class="tactions">${g.down ? `<button class="btn" type="button" data-rep-do="back">Put back</button>` : g.name == null ? "" : `<button class="btn danger" type="button" data-rep-do="down">Take down</button>`}${g.reports.length ? `<button class="btn" type="button" data-rep-do="dismiss">Dismiss ${g.reports.length === 1 ? "report" : "reports"}</button>` : ""}</div></div>`).join("");
    box.querySelectorAll("[data-rep-do]").forEach((b) => (b.onclick = async () => {
      const g = by.get(b.closest("[data-rep]").dataset.rep), sh = platform.shared(g.id), name = `“${tidy(g.name, 60) || "this notebook"}”`;
      if (b.dataset.repDo === "dismiss" && !(await ask(`Dismiss ${g.reports.length === 1 ? "this report" : "these reports"}?`, `<p>The ${plural(g.reports.length, "report")} about it ${g.reports.length === 1 ? "is" : "are"} deleted. The notebook stays as it is.</p>`, "Dismiss"))) return;
      if (b.dataset.repDo === "down" && !(await ask(`Take down ${name}?`, `<p>Its link stops working for everyone but its owner and developers. People who already added the notebook keep what they have, and get no more changes.</p>`, "Take down", true))) return;
      b.disabled = true; $("#repMsg").hidden = true;
      try {
        if (b.dataset.repDo === "down") { await sh.down.set({ at: new Date().toISOString() }); await sh.listing.delete(); } // off the Browse page too
        else if (b.dataset.repDo === "back") await sh.down.delete();
        else for (const r of g.reports) await platform.reports.doc(r.id).delete();
      } catch { $("#repMsg").textContent = "Couldn't do that. Try again."; $("#repMsg").hidden = false; }
      renderReports();
    }));
  }
  $("#repRefresh").onclick = renderReports;

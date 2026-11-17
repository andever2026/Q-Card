  // ---------- reporting a shared notebook (public site) ----------
  // Sharing passes along what other people typed in, so the page a shared notebook's link opens has "Report this
  // notebook". Anyone can send a report, signed in or not: which notebook, one of the reasons and what they wrote, and
  // nothing about who sent it. Only developers can read reports (firestore.rules); theirs is Settings → Admin (moderation.js).
  const REPORT_WHY = { copyright: "It's copied from a textbook or other copyrighted work", other: "Something else" };
  // True once the report is sent.
  async function reportShared(id) {
    const sent = ask("Report this notebook", `<p>What's wrong with it?</p>
      ${Object.entries(REPORT_WHY).map(([k, t], i) => `<label class="checkrow"><input type="radio" name="repWhy" value="${k}"${i ? "" : " checked"}> ${t}</label>`).join("")}
      <textarea class="repnote" id="repNote" maxlength="1000" rows="4" aria-label="Details" placeholder="Details: what it's copied from, or what the problem is"></textarea>
      <p class="muted small">The report says which notebook, your reason and your details. It doesn't say who sent it.</p>`, "Send report");
    $("#askText input").focus();
    if (!(await sent)) return false;
    const why = $("#askText [name=repWhy]:checked")?.value || "other", note = tidy($("#repNote").value, 1000);
    try { await platform.reports.doc(rid() + rid()).set({ share: id, why, note, at: new Date().toISOString() }); }
    catch { banner("Couldn't send the report. Try again."); return false; }
    return true;
  }
  // Whether a developer took this shared notebook down after a report (moderation.js): then its link works only for
  // its owner and for developers.
  const takenDown = async (id) => !!(await platform.shared(id).down.get().catch(() => null))?.exists;

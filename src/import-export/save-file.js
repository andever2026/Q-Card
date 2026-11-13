// Hands the browser a file to save (a download), from text or a Blob: the site's exports and the study tools' sheets.
export function saveFile(filename, data) {
  const type = /\.json$/i.test(filename) ? "application/json" : "application/octet-stream";
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

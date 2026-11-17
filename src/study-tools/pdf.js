// A one-page PDF of short pieces of text in Helvetica Bold, a font every PDF reader has, so nothing is embedded.
// Only plain ASCII text comes out right.
//   pdfOfText(width, height, [{ x, y, size, text }]) → Blob; sizes in points, x and y from the bottom left.
export function pdfOfText(w, h, items) {
  const esc = (t) => String(t).replace(/[\\()]/g, (c) => "\\" + c);
  const stream = items.map(({ x, y, size, text }) => `BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(text)}) Tj ET`).join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  let out = "%PDF-1.4\n";
  const at = objs.map((o, i) => { const n = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return n; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: "application/pdf" });
}

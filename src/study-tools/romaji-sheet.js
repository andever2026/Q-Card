// Romaji sheet: a US letter page (landscape) of 9 panels, each with the romaji of the 46 basic kana in its own random
// order, a small label in the corner of each cell and the rest left for writing the kana. Print, cut along the gaps, and
// hand them out or keep one a day. Every new sheet is shuffled again.
import { pdfOfText } from "./pdf.js";
import { printSheet } from "./print.js";
import { saveFile } from "../import-export/save-file.js";

const ROMAJI = ["a", "i", "u", "e", "o", "ka", "ki", "ku", "ke", "ko", "sa", "shi", "su", "se", "so", "ta", "chi", "tsu", "te", "to",
  "na", "ni", "nu", "ne", "no", "ha", "hi", "fu", "he", "ho", "ma", "mi", "mu", "me", "mo", "ya", "yu", "yo",
  "ra", "ri", "ru", "re", "ro", "wa", "wo", "n"];
// In points (72 to the inch).
const W = 792, H = 612, MARGIN = 0.3 * 72, GAP = 0.12 * 72, PANELS = 3, COLS = 6, SIZE = 6;
const PW = (W - 2 * MARGIN - (PANELS - 1) * GAP) / PANELS, PH = (H - 2 * MARGIN - (PANELS - 1) * GAP) / PANELS;
const CW = PW / COLS, CH = PH / Math.ceil(ROMAJI.length / COLS);

function shuffled(xs) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Every label on a new sheet, placed as in the PDF (from the bottom left).
function newSheet() {
  const items = [];
  for (let p = 0; p < PANELS * PANELS; p++) {
    const x0 = MARGIN + (p % PANELS) * (PW + GAP), top = H - MARGIN - Math.floor(p / PANELS) * (PH + GAP);
    shuffled(ROMAJI).forEach((text, i) => items.push({ x: x0 + (i % COLS) * CW + 2, y: top - Math.floor(i / COLS) * CH - 7, size: SIZE, text }));
  }
  return items;
}
// The same sheet as SVG, for the preview and for printing. The dashed panel edges show only on screen.
function svg(items, cls) {
  const edges = Array.from({ length: PANELS * PANELS }, (_, p) => `<rect class="edge" x="${MARGIN + (p % PANELS) * (PW + GAP)}" y="${MARGIN + Math.floor(p / PANELS) * (PH + GAP)}" width="${PW}" height="${PH}"/>`).join("");
  const labels = items.map(({ x, y, text }) => `<text x="${x.toFixed(2)}" y="${(H - y).toFixed(2)}">${text}</text>`).join("");
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Romaji sheet: 9 panels of the 46 basic kana in random order">${edges}<g font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${SIZE}">${labels}</g></svg>`;
}

export const romajiSheet = {
  id: "romaji-sheet",
  name: "Romaji sheet",
  about: "Nine panels of the 46 basic kana as romaji, each in a new random order. Print, cut along the gaps, and write the kana in each box: one panel a day, or hand them out.",
  mount(box) {
    let items = newSheet();
    box.innerHTML = `<div class="tactions"><button class="btn" type="button" data-new>New sheet</button><button class="btn" type="button" data-print>Print</button>
      <button class="btn primary" type="button" data-newprint>New sheet and print</button><button class="btn" type="button" data-pdf>Download PDF</button></div>
      <div class="sheet"></div>`;
    const show = () => (box.querySelector(".sheet").innerHTML = svg(items, "preview"));
    const print = () => printSheet(svg(items, "printed"));
    box.querySelector("[data-new]").onclick = () => { items = newSheet(); show(); };
    box.querySelector("[data-print]").onclick = print;
    box.querySelector("[data-newprint]").onclick = () => { items = newSheet(); show(); print(); };
    box.querySelector("[data-pdf]").onclick = () => saveFile(`romaji-sheet-${new Date().toLocaleDateString("en-CA")}.pdf`, pdfOfText(W, H, items));
    show();
  },
};

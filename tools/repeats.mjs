// Fails when the same code is written out in two places under src/: each behaviour of the site has one implementation,
// in the folder named for what it does, and everything else calls it (see CLAUDE.md). Run by `npm run check`.
// It looks for a long line that appears twice, and for a run of three or more lines that appears twice, comparing lines
// with their indentation taken off. Comments, markers for the build and lines that are only brackets don't count.
// A repeat that has to stay (CSS has no way to say "the same values again") is listed in ALLOWED with its reason.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LONG = 70, RUN = 3, RUN_CHARS = 90;
const ALLOWED = [
  // theme.css: dark mode's colours are set once for "the device is dark" (a media query) and once for "Dark was picked"
  // (data-theme), and CSS can't share a block between the two.
  /^--(bg|ai): #[0-9a-f]{6}; --(surface|ai-soft): /,
];

// Code only: a page's markup and wording (the .html files) may say the same thing twice.
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(js|css)$/.test(f) ? [p] : []; });
const skip = (t) => !t || /^(\/\/|\/\*|\*|<!--)/.test(t) || !/[A-Za-z0-9]{3}/.test(t) || ALLOWED.some((re) => re.test(t));
const lines = walk(join(root, "src")).flatMap((file) => readFileSync(file, "utf8").split("\n")
  .map((text, i) => ({ file: relative(root, file), n: i + 1, t: text.trim() })).filter((l) => !skip(l.t)));

const found = [];
const at = (l) => `${l.file}:${l.n}`;
// A long line written twice.
const byText = new Map();
for (const l of lines) (byText.get(l.t) ?? byText.set(l.t, []).get(l.t)).push(l);
for (const [t, ls] of byText) if (t.length >= LONG && ls.length > 1) found.push({ where: ls.map(at), text: t });
// A run of lines written twice (shorter lines count when they repeat together).
const runs = new Map();
for (let i = 0; i + RUN <= lines.length; i++) {
  const run = lines.slice(i, i + RUN);
  if (run.some((l) => l.file !== run[0].file) || run.map((l) => l.t).join("").length < RUN_CHARS) continue;
  const key = run.map((l) => l.t).join("\n");
  (runs.get(key) ?? runs.set(key, []).get(key)).push(run[0]);
}
const covered = new Set(found.flatMap((f) => f.where));
for (const [key, starts] of runs) if (starts.length > 1 && !starts.every((s) => covered.has(at(s)))) { found.push({ where: starts.map(at), text: key }); starts.forEach((s) => covered.add(at(s))); }

if (found.length) {
  console.error(`The same code is written in more than one place (${found.length}):\n`);
  for (const f of found) console.error(`${f.where.join(", ")}\n${f.text.split("\n").map((l) => "    " + (l.length > 160 ? l.slice(0, 160) + "…" : l)).join("\n")}\n`);
  console.error("Keep one of them, in the folder named for what it does, and have the other place use it.");
  process.exit(1);
}
console.log("No code is written twice under src/.");

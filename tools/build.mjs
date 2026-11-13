// Builds both versions of the page from src/page/page.html and the files it includes from src/:
//   index.html, js/*.js           the public site (GitHub Pages): Google sign-in, Firestore, built-in checker
//                                 (js/templates.js and js/samples.js are data/*.json as scripts: a page opened straight
//                                 from disk may load scripts, though not fetch files, so the site works offline that way too)
//   ai/, privacy/                 the site's side pages, from src/side-pages/ (with css/theme.css, js/pages.js and js/ai.js)
//   study-tools/                  the Study tools page, from src/study-tools/ (with js/tools.js)
//   build/claude-ai.html          the claude.ai artifact (the owner's own copy, using claude.ai's database and Claude)
// src/page/page.html is the page's markup. A line that is only an include marker is replaced by that file from src/, as is:
//   /*#include page/styles.css*/   //#include page/core.js
// The page's code is one function split over the folders of src/ (one per function of the page), in page order, so those files share their names and
// aren't scripts of their own: the build puts them back together into the single page both versions need.
// Lines can be limited to one version, in any of those files:
//   <!--#if public-->  //#if claude  /*#if public*/   …   #else   …   #endif
// Marker lines themselves never reach the output.
// `node tools/build.mjs --check` fails if the committed public files are out of date.
// `node tools/build.mjs --beta` builds the beta site instead (see .github/workflows/pages.yml); it's never committed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => join(root, p);
const check = process.argv.includes("--check");
const beta = process.argv.includes("--beta");

const INCLUDE = /^\s*(?:<!--|\/\/|\/\*)\s*#include\s+(\S+?)\s*(?:-->|\*\/)?\s*$/;
export function expand(file, seen = []) {
  if (seen.includes(file)) throw new Error(`#include loop: ${[...seen, file].join(" → ")}`);
  if (!existsSync(at(file))) throw new Error(`${seen.at(-1) ?? file}: #include ${file} not found`);
  const text = readFileSync(at(file), "utf8");
  return (seen.length ? text.replace(/\n$/, "") : text).split("\n") // an included file's last newline ends the include line
    .map((line) => { const m = line.match(INCLUDE); return m ? expand(join("src", m[1]), [...seen, file]) : line; }).join("\n");
}

const MARK = /^\s*(?:<!--|\/\/|\/\*)\s*#(if|else|endif)\b\s*(public|claude)?\s*(?:-->|\*\/)?\s*$/;
export function preprocess(text, target) {
  const out = [], stack = [];
  text.split("\n").forEach((line, i) => {
    const m = line.match(MARK);
    if (!m) { if (stack.every((s) => s.on)) out.push(line); return; }
    if (m[1] === "if") { if (!m[2]) throw new Error(`line ${i + 1}: #if needs public or claude`); stack.push({ on: m[2] === target }); }
    else if (!stack.length) throw new Error(`line ${i + 1}: #${m[1]} without #if`);
    else if (m[1] === "else") stack.at(-1).on = !stack.at(-1).on;
    else stack.pop();
  });
  if (stack.length) throw new Error("#if without #endif");
  return out.join("\n");
}

const sha = (s) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
// What a page may load and where it may send data, written into its <!--CSP--> line. A page that runs js/platform.js
// (firebase: the site itself, and the AI page for its Import) may reach Firebase; the others reach nothing outside the site.
function csp(html, { firebase = false, images = "data:" } = {}) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => sha(m[1]));
  const policy = [
    "default-src 'none'",
    // apis.google.com: Firebase's Google sign-in popup loads Google's iframe helper from there.
    `script-src ${["'self'", ...hashes, ...(firebase ? ["https://apis.google.com"] : [])].join(" ")}`,
    // Fonts are served from the site itself (fonts/, see tools/fetch-fonts.mjs), so visitors never contact Google Fonts.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src ${images}`,
    // The only places a page sends data: its own files and Firebase (sign-in and the database).
    ...(firebase ? ["connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
      "frame-src https://q-card-project.firebaseapp.com https://apis.google.com https://accounts.google.com"] : []),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  if (!html.includes("<!--CSP-->")) throw new Error("a page has no <!--CSP--> line");
  return html.replace("<!--CSP-->", () => `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
}

// Firestore only uses re2js for regex pipeline queries, which the page never runs; leaving it out saves ~150 KB.
const noRegex = { name: "no-re2js", setup(b) {
  b.onResolve({ filter: /^re2js$/ }, () => ({ path: "re2js", namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const RE2JS = { compile() { throw new Error("regex pipelines are not included"); } };' }));
} };
const LICENSES = "Firebase JS SDK (Apache-2.0), Q-Card code (AGPL-3.0)";
async function bundle(imports, licenses = LICENSES) {
  const r = await esbuild.build({
    stdin: { contents: imports.map((f) => `import "./${f}";`).join("\n"), resolveDir: root, sourcefile: "entry.js" },
    bundle: true, format: "iife", minify: true, target: "es2020", write: false, legalComments: "eof", plugins: [noRegex],
    banner: { js: `/* Q-Card, built by tools/build.mjs from src/ (edit those, not this file). Includes ${licenses}. */` },
  });
  return r.outputFiles[0].text;
}

// The beta site lives on the same site as the live one (/Q-Card/beta/), so it gets its own browser storage keys
// ("jpq-beta:…", "qcard-beta:…"): trying things there never touches the live site's guest data or settings.
// Signing in with Google is shared, so beta uses the same account and its data.
function toBeta(text, file) {
  const out = text.replaceAll('"jpq:', '"jpq-beta:').replaceAll('"qcard:', '"qcard-beta:');
  if (file !== "index.html") return out;
  const tag = '<span style="font-size:.45em; vertical-align:middle; padding:2px 8px; border-radius:99px; background:var(--ink); color:var(--surface)">Beta</span>';
  const page = out.replaceAll("<title>Japanese Vocab Practice</title>", "<title>Japanese Vocab Practice (beta)</title>")
    .replace("<h1>Japanese Vocab Practice</h1>", `<h1>Japanese Vocab Practice ${tag}</h1>`);
  if (!page.includes(tag)) throw new Error("beta: couldn't find the page title to tag");
  return page;
}
const variant = (text, file) => (beta ? toBeta(text, file) : text);
// data/<name>.json as js/<name>.js, which leaves it in window.QCardData[name] for the page to pick up (see dataFile in src/page/data-files.js).
const dataScript = (name) => ({
  [`js/${name}.js`]: `// Made by tools/build.mjs from data/${name}.json; edit that file instead.\n` +
    `(window.QCardData = window.QCardData || {})[${JSON.stringify(name)}] = ${JSON.stringify(JSON.parse(readFileSync(at(`data/${name}.json`), "utf8")))};\n`,
});

const made = (f) => `Made by tools/build.mjs from src/${f}; edit that file instead.`;
const script = (f) => variant(`// ${made(f)}\n${preprocess(expand(`src/${f}`), "public")}`, `js/${f.split("/").at(-1)}`);
const sidePage = (f, load) => variant(csp(preprocess(expand(`src/${f}`), "public"), load).replace("<head>\n", `<head>\n<!-- ${made(f)} -->\n`), f);
const src = expand("src/page/page.html");
const page = variant(preprocess(src, "public"), "index.html");
const files = {
  "index.html": csp(page, { firebase: true, images: "'self' data: blob:" }),
  "js/platform.js": variant(await bundle(["src/account/firebase.js", ...(existsSync(at("src/checking/checker.js")) ? ["src/checking/checker.js"] : [])]), "js/platform.js"),
  ...dataScript("templates"),
  ...dataScript("samples"),
  // The side pages (ai/, privacy/): plain HTML that takes the site's look from css/theme.css and the colours picked in
  // Settings from js/pages.js. The AI page's Copy and Import are js/ai.js.
  "css/theme.css": `/* Made by tools/build.mjs from src/theme/theme.css; edit that file instead. */\n${readFileSync(at("src/theme/theme.css"), "utf8")}`,
  "js/pages.js": script("side-pages/pages.js"),
  "js/ai.js": script("side-pages/ai.js"),
  "ai/index.html": sidePage("side-pages/ai.html", { firebase: true }),
  "privacy/index.html": sidePage("side-pages/privacy.html"),
  // Study tools (study-tools/): one card per tool, each tool a module in src/study-tools/.
  "js/tools.js": variant(await bundle(["src/study-tools/tools.js"], "Q-Card code (AGPL-3.0)"), "js/tools.js"),
  "study-tools/index.html": sidePage("study-tools/tools.html"),
};

if (check && beta) throw new Error("--check is for the committed files; the beta build is never committed");
if (check) {
  const stale = Object.entries(files).filter(([p, t]) => !existsSync(at(p)) || readFileSync(at(p), "utf8") !== t).map(([p]) => p);
  if (stale.length) { console.error(`Out of date: ${stale.join(", ")}. Run npm run build and commit the result.`); process.exit(1); }
  console.log("Built files are up to date.");
} else {
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(at(p)), { recursive: true }); writeFileSync(at(p), t); }
  mkdirSync(at("build"), { recursive: true });
  writeFileSync(at("build/claude-ai.html"), preprocess(src, "claude"));
  console.log(`Wrote ${Object.keys(files).join(", ")} and build/claude-ai.html`);
}

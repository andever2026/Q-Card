// Builds both versions of the page from src/app.html:
//   index.html, js/*.js           the public site (GitHub Pages): Google sign-in, Firestore, built-in checker
//   build/claude-ai.html          the claude.ai artifact (Annie's own copy, using claude.ai's database and Claude)
// Lines in src/app.html can be limited to one version:
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
function csp(html) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => sha(m[1]));
  return [
    "default-src 'none'",
    // apis.google.com: Firebase's Google sign-in popup loads Google's iframe helper from there.
    `script-src 'self' ${hashes.join(" ")} https://apis.google.com`,
    // Fonts are served from the site itself (fonts/, see tools/fetch-fonts.mjs), so visitors never contact Google Fonts.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    // The only places the page sends data: its own files and Firebase (sign-in and the database).
    "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    "frame-src https://q-card-project.firebaseapp.com https://apis.google.com https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// Firestore only uses re2js for regex pipeline queries, which the page never runs; leaving it out saves ~150 KB.
const noRegex = { name: "no-re2js", setup(b) {
  b.onResolve({ filter: /^re2js$/ }, () => ({ path: "re2js", namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const RE2JS = { compile() { throw new Error("regex pipelines are not included"); } };' }));
} };
const LICENSES = "Firebase JS SDK (Apache-2.0), Q-Card code (AGPL-3.0)";
async function bundle(imports) {
  const r = await esbuild.build({
    stdin: { contents: imports.map((f) => `import "./${f}";`).join("\n"), resolveDir: root, sourcefile: "entry.js" },
    bundle: true, format: "iife", minify: true, target: "es2020", write: false, legalComments: "eof", plugins: [noRegex],
    banner: { js: `/* Q-Card, built by tools/build.mjs from src/ (edit those, not this file). Includes ${LICENSES}. */` },
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

const src = readFileSync(at("src/app.html"), "utf8");
const page = variant(preprocess(src, "public"), "index.html");
const files = {
  "index.html": page.replace("<!--CSP-->", () => `<meta http-equiv="Content-Security-Policy" content="${csp(page)}">`),
  "js/platform.js": variant(await bundle(["src/platform/firebase.js", ...(existsSync(at("src/checker.js")) ? ["src/checker.js"] : [])]), "js/platform.js"),
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

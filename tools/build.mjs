// Builds both versions of the page from src/app.html:
//   index.html, js/*.js           the public site (GitHub Pages): Google sign-in, Firestore, own-key Claude, built-in checker
//   build/claude-ai.html          the claude.ai artifact (the owner's own copy, using claude.ai's database and Claude)
// Lines in src/app.html can be limited to one version:
//   <!--#if public-->  //#if claude  /*#if public*/   …   #else   …   #endif
// Marker lines themselves never reach the output.
// `node tools/build.mjs --check` fails if the committed public files are out of date.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => join(root, p);
const check = process.argv.includes("--check");

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
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    // The only places the page sends data: its own files, Firebase (sign-in and the database) and, with a visitor's own key, Anthropic.
    "connect-src 'self' https://api.anthropic.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
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
const LICENSES = "Firebase JS SDK (Apache-2.0), Anthropic TypeScript SDK (MIT), Q-Card code (AGPL-3.0)";
async function bundle(imports) {
  const r = await esbuild.build({
    stdin: { contents: imports.map((f) => `import "./${f}";`).join("\n"), resolveDir: root, sourcefile: "entry.js" },
    bundle: true, format: "iife", minify: true, target: "es2020", write: false, legalComments: "eof", plugins: [noRegex],
    banner: { js: `/* Q-Card, built by tools/build.mjs from src/ (edit those, not this file). Includes ${LICENSES}. */` },
  });
  return r.outputFiles[0].text;
}

const src = readFileSync(at("src/app.html"), "utf8");
const pub = preprocess(src, "public").replace("<!--CSP-->", () => `<meta http-equiv="Content-Security-Policy" content="${csp(preprocess(src, "public"))}">`);
const files = {
  "index.html": pub,
  "js/platform.js": await bundle(["src/platform/firebase.js", ...(existsSync(at("src/checker.js")) ? ["src/checker.js"] : [])]),
  "js/claude.js": await bundle(["src/platform/claude.js"]),
};

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

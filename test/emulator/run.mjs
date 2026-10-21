// Browser tests for the public site (index.html) against the real Firebase SDK and the real firestore.rules, on the Firebase
// emulators (Auth and Firestore). test/public/run.mjs covers the page with an in-memory fake; these catch what a fake can't:
// what Firestore really accepts and refuses, the rules themselves, and the SDK's own behaviour.
// src/platform/firebase.js is bundled as is, except that it connects to the emulators, uses the project demo-qcard (so nothing
// can reach the real project) and signs in with a made-up Google account instead of Google's pop-up.
// Run (needs firebase-tools and Java 21, and Playwright like test/public; PLAYWRIGHT_DIR overrides where it lives):
//   npx firebase emulators:exec --config test/emulator/firebase.json --only auth,firestore --project demo-qcard "node test/emulator/run.mjs"
// or start the emulators once with emulators:start and the same options, then run node test/emulator/run.mjs as often as you like.
// firestore.rules is loaded into the emulator at the start of every run, and the emulators are wiped before each part.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || "/opt/node-tools/node_modules/playwright");

let failures = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${msg}${extra ? "  " + extra : ""}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The emulators answer in their own time: poll until fn gives something truthy (errors, like a page mid-reload, count as not yet).
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  let v;
  do { try { v = await fn(); if (v) return v; } catch {} await sleep(250); } while (Date.now() < end);
  return v;
}

// ---------- the emulators ----------
// emulators:exec sets these; the defaults match test/emulator/firebase.json.
const PROJECT = "demo-qcard";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FS = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: "Bearer owner", "content-type": "application/json" }; // the emulators' admin access, past the rules

for (const [name, host] of [["Firestore", FS_HOST], ["Auth", AUTH_HOST]]) {
  if (!(await fetch(`http://${host}/`).then(() => true, () => false))) {
    console.error(`The ${name} emulator isn't running at ${host}. Start the emulators first:\n` +
      `  npx firebase emulators:exec --config test/emulator/firebase.json --only auth,firestore --project ${PROJECT} "node test/emulator/run.mjs"`);
    process.exit(1);
  }
}
{
  const r = await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}:securityRules`, { method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: readFileSync(join(root, "firestore.rules"), "utf8") }] } }) });
  if (!r.ok) { console.error("The Firestore emulator didn't take firestore.rules:\n" + await r.text()); process.exit(1); }
  console.log("firestore.rules loaded into the Firestore emulator"); // test/emulator/firebase.json names none: it can't point outside its folder
}
async function clearEmulators() {
  for (const url of [`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`]) {
    const r = await fetch(url, { method: "DELETE" });
    if (!r.ok) throw new Error(`couldn't clear ${url}: ${r.status}`);
  }
}

// Reading Firestore as the console would: REST values → plain JS.
const fromValue = (v) => "mapValue" in v ? fromFields(v.mapValue.fields) : "arrayValue" in v ? (v.arrayValue.values || []).map(fromValue)
  : "integerValue" in v ? Number(v.integerValue) : "nullValue" in v ? null : Object.values(v)[0];
const fromFields = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
async function getDoc(path) {
  const r = await fetch(`${FS}/${path}`, { headers: OWNER });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return fromFields((await r.json()).fields);
}
// Every document under users/<uid>, at any depth, by path.
async function docsOf(uid) {
  const r = await fetch(`${FS}/users/${uid}:runQuery`, { method: "POST", headers: OWNER, body: JSON.stringify({ structuredQuery: { from: [{ allDescendants: true }] } }) });
  if (!r.ok) throw new Error(`query users/${uid}: ${r.status}`);
  return Object.fromEntries((await r.json()).filter((x) => x.document).map(({ document: d }) => [d.name.split("/documents/")[1], fromFields(d.fields)]));
}
const authUsers = async () => (await (await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: "POST", headers: OWNER, body: "{}" })).json()).userInfo || [];

// ---------- the page ----------
// src/platform/firebase.js and src/checker.js, as tools/build.mjs bundles them, with firebase/auth, firebase/firestore and
// ./config.js wrapped: the real SDK, connected to the emulators. window.__googleUser is who "Google" signs in.
const shims = {
  "firebase/auth": `export * from "firebase/auth";
    import { getAuth as realGetAuth, connectAuthEmulator, signInWithCredential, reauthenticateWithCredential, GoogleAuthProvider } from "firebase/auth";
    const google = () => GoogleAuthProvider.credential(JSON.stringify(window.__googleUser));
    export function getAuth(app) { const auth = realGetAuth(app); connectAuthEmulator(auth, "http://${AUTH_HOST}", { disableWarnings: true }); window.__testAuth = auth; return auth; }
    export const signInWithPopup = (auth) => signInWithCredential(auth, google());
    export const reauthenticateWithPopup = (user) => reauthenticateWithCredential(user, google());`,
  "firebase/firestore": `export * from "firebase/firestore";
    import { initializeFirestore as realInit, connectFirestoreEmulator } from "firebase/firestore";
    export function initializeFirestore(app, settings) { const fs = realInit(app, settings); connectFirestoreEmulator(fs, ${JSON.stringify(FS_HOST.replace(/:\d+$/, ""))}, ${+FS_HOST.split(":").at(-1)}); return fs; }`,
  config: `import config from ${JSON.stringify(join(root, "src/platform/config.js"))}; export default { ...config, projectId: "${PROJECT}" };`,
};
const emulate = { name: "emulators", setup(b) {
  // The shims' own imports of the SDK resolve as usual (onResolve returns nothing for them).
  b.onResolve({ filter: /^firebase\/(auth|firestore)$/ }, (a) => (a.namespace === "emu" ? undefined : { path: a.path, namespace: "emu" }));
  b.onResolve({ filter: /^\.\/config\.js$/ }, (a) => (/platform[\\/]firebase\.js$/.test(a.importer) ? { path: "config", namespace: "emu" } : undefined));
  b.onLoad({ filter: /.*/, namespace: "emu" }, (a) => ({ contents: shims[a.path], resolveDir: root, loader: "js" }));
} };
const entry = ['import "./src/platform/firebase.js";', ...(existsSync(join(root, "src/checker.js")) ? ['import "./src/checker.js";'] : [])];
const platformJs = (await esbuild.build({
  stdin: { contents: entry.join("\n"), resolveDir: root, sourcefile: "emulator-entry.js" },
  bundle: true, format: "iife", write: false, plugins: [emulate],
})).outputFiles[0].text;

// The built page, with the emulators added to its Content-Security-Policy's connect-src.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  let body = readFileSync(p);
  if (extname(p) === ".html") {
    const html = body.toString(), widened = html.replace("connect-src 'self'", `connect-src 'self' http://${FS_HOST} http://${AUTH_HOST}`);
    if (widened === html) throw new Error(`${p}: no connect-src to add the emulators to`);
    body = widened;
  }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();

async function openSite(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 900, height: 1000 });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.addInitScript((u) => {
    window.__googleUser = u;
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  }, { sub: "google-" + name, email: name + "@example.com", email_verified: true, name });
  await page.route("**/js/platform.js", (r) => r.fulfill({ contentType: "text/javascript", body: platformJs }));
  await page.goto(base);
  return page;
}
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.closest("[hidden]") && getComputedStyle(e).display !== "none"; }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? null, sel);
const pressed = (page, sel) => page.$eval(sel, (b) => b.getAttribute("aria-pressed") === "true");
const welcomeOpen = (page) => page.evaluate(() => document.querySelector("#welcome").open);
async function scribble(page, sel = "#mainPad") {
  const b = await (await page.$(sel)).boundingBox();
  await page.mouse.move(b.x + 30, b.y + 30); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 30 + i * 8, b.y + 30 + (i % 2) * 20);
  await page.mouse.up();
}
// Sign in with Google from the welcome pop-up; the page reloads into the account (see src/app/boot.js). Gives the uid.
async function signIn(page) {
  await until(() => welcomeOpen(page));
  await page.evaluate(() => { window.__beforeSignIn = true; });
  await page.click("#signInBtn");
  return until(() => page.evaluate(() => !window.__beforeSignIn && document.body.classList.contains("ready") && window.__testAuth?.currentUser?.uid));
}
// Signed in with the sample sets in place, which every new account gets first.
async function newAccount(name) {
  await clearEmulators();
  const page = await openSite(name), uid = await signIn(page);
  if (!uid) throw new Error("sign-in didn't finish");
  await until(async () => (await getDoc(`users/${uid}/meta/samples`)) && vis(page, '[data-set="samples-greetings"]'));
  return { page, uid };
}
// "Another device": the same account, with none of this browser's choices (jpq:…) left.
async function asAnotherDevice(page) {
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("jpq:")) localStorage.removeItem(k); });
  await page.reload();
  await until(() => page.evaluate(() => document.body.classList.contains("ready") && !!window.__testAuth?.currentUser));
}
// When one of its streams breaks (here: the page reloading mid-request after Delete my account), Firestore's WebChannel loads
// www.google.com/images/cleardot.gif only to count in its own stats whether the network is up. The page's img-src blocks
// that, which changes nothing else, so it isn't counted here.
const harmless = (m) => /www\.google\.com\/images\/cleardot\.gif/.test(m);
const clean = async (page, label) => {
  const problems = [...page.errors, ...await page.evaluate(() => window.__csp).catch(() => ["(page gone)"])].filter((m) => !harmless(m));
  ok(!problems.length, `${label}: no page errors or CSP violations`, problems.join(" | "));
};
// One part of the tests; an exception fails it and the rest still run.
async function part(name, fn) {
  console.log(`\n${name}`);
  try { await fn(); } catch (e) { ok(false, `${name}: stopped early`, e.message.split("\n")[0]); }
}

// ---------- 1. first visit, sign in: sample sets and choices land in the account ----------
await part("1. First visit and sign in", async () => {
  await clearEmulators();
  const page = await openSite("first");
  ok(await until(() => welcomeOpen(page)), "first visit: the welcome pop-up opens");
  const uid = await signIn(page);
  await page.click("#settingsBtn");
  ok(!!uid && /first@example\.com/.test(await text(page, "#acctName")), "sign in with Google (Auth emulator): the page reloads into the account", await text(page, "#acctName"));
  await page.click("#settingsClose");
  const d = await until(async () => { const d = await docsOf(uid); return d[`users/${uid}/meta/samples`] && d; });
  const ids = (col) => Object.keys(d || {}).filter((p) => p.startsWith(`users/${uid}/${col}/samples-`));
  ok(ids("sets").length === 6 && ids("kanji").length === 3 && !!d?.[`users/${uid}/meta/samples`]?.offeredAt,
    "samples: 6 sample sets and 3 kanji lists saved in the account, the offer recorded in meta/samples", Object.keys(d || {}).map((p) => p.split("/").slice(2).join("/")).join(", "));
  ok(await until(() => vis(page, '[data-set="samples-greetings"]')), "samples: the page lists them");
  await page.click('[data-set="samples-food"]'); await page.click("#dir-je"); await page.click("#mode-kana");
  await page.click("#settingsBtn"); await page.click('#themePick [data-theme-pick="dark"]'); await page.click("#settingsClose");
  const prefs = await until(async () => { const p = await getDoc(`users/${uid}/data/prefs`); return p?.dir === "je" && p.mode === "kana" && p.theme === "dark" && p; });
  ok(!!prefs && prefs.selected?.includes("samples-food"), "choices: saved to users/<uid>/data/prefs", JSON.stringify(prefs || {}).slice(0, 160));
  await asAnotherDevice(page);
  ok(await until(async () => await pressed(page, "#dir-je") && await pressed(page, "#mode-kana") && await pressed(page, '[data-set="samples-food"]')) &&
    await page.evaluate(() => document.documentElement.dataset.theme === "dark"), "choices: come back from the account on another device");
  await clean(page, "first visit");
  await page.context().close();
});

// ---------- 2. a practice quit midway, with writing on the open question ----------
await part("2. Resume with writing", async () => {
  const { page, uid } = await newAccount("resume");
  await page.click('[data-set="samples-greetings"]'); await page.click("#startBtn");
  await until(() => vis(page, "#quiz"));
  await scribble(page); await scribble(page);
  await page.click("#quitBtn");
  const prefs = await until(async () => { const p = await getDoc(`users/${uid}/data/prefs`); return p?.resume?.ink && p; });
  const r = prefs?.resume, s = r?.ink?.main?.s || [];
  ok(Array.isArray(r?.items) && r.items.length === 8 && r.pending?.length === 8, "resume: the practice left midway is saved in the account's prefs", r ? `${r.items?.length} words, ${r.pending?.length} to do` : "no resume");
  ok(s.length === 2 && s.every((st) => Array.isArray(st.p) && st.p.length > 4 && st.p.every((n) => typeof n === "number")),
    "resume: with the writing on the open question, each stroke a flat list of numbers", JSON.stringify(s[0])?.slice(0, 100));
  await asAnotherDevice(page);
  ok(await until(() => vis(page, "#resumeBtn")), "resume: Resume last practice comes back from the account on another device");
  await page.click("#resumeBtn");
  ok(await until(() => page.evaluate(() => { const c = document.querySelector("#mainPad"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })),
    "resume: the writing comes back in the answer box");
  await clean(page, "resume");
  await page.context().close();
});

// ---------- 3. sharing handwriting: each checked answer saved to training/, Settings deletes them ----------
await part("3. Sharing handwriting", async () => {
  const { page, uid } = await newAccount("share");
  await page.click("#settingsBtn");
  ok(/^Off\./.test(await text(page, "#shareInfo")), "share: off for a new account", await text(page, "#shareInfo"));
  await page.click("#shareToggle");
  await until(() => page.evaluate(() => document.querySelector("#shareAsk").open));
  await page.click("#shareYes");
  await page.click("#settingsClose");
  ok(!!(await until(async () => (await getDoc(`users/${uid}/data/prefs`))?.share?.on === true)), "share: Settings → Turn on… → Yes is saved in the account's prefs");
  await page.click('[data-set="samples-greetings"]'); await page.click("#dir-je"); await page.click("#startBtn");
  await until(() => vis(page, "#quiz"));
  await scribble(page); await scribble(page); await page.click("#checkBtn");
  await until(() => vis(page, "#selfCheck"));
  await page.click("#selfGot");
  const training = async () => Object.entries(await docsOf(uid)).filter(([p]) => p.startsWith(`users/${uid}/training/`));
  const tr = await until(async () => { const t = await training(); return t.length && t[0][1].student && t; }) || await training();
  const rec = tr[0]?.[1], st = rec?.main?.s?.[0];
  ok(tr.length === 1 && rec.dir === "je" && !!rec.word?.en && !!rec.checker?.verdict && rec.student === "right",
    "share: checking an answer writes users/<uid>/training/<id> with the word, the checker's verdict and the student's own call", JSON.stringify(rec && { ...rec, main: undefined, furi: undefined })?.slice(0, 200));
  ok(rec?.main?.s?.length === 2 && st.xy.length > 4 && st.xy.every((n) => typeof n === "number") && st.xy.length === 2 * st.t.length && st.t.length === st.f.length,
    "share: its strokes are stored as flat lists (points, timing, pressure)", JSON.stringify(st)?.slice(0, 120));
  await page.waitForTimeout(1500); // the 花丸 for a right answer, then the next question
  await page.click("#quitBtn");
  await page.click("#settingsBtn");
  ok(await until(async () => /1 answer shared/.test(await text(page, "#shareInfo")) && vis(page, "#shareDel")), "share: Settings counts the shared answer", await text(page, "#shareInfo"));
  await page.click("#shareDel"); await page.click("#shareDelYes");
  ok(await until(async () => !(await training()).length && /0 answers shared/.test(await text(page, "#shareInfo"))), "share: Settings → Delete what I've shared removes them from Firestore", (await training()).map(([p]) => p).join(", "));
  await page.click("#settingsClose");
  await clean(page, "share");
  await page.context().close();
});

// ---------- 4. Dev tools: only when dev/<uid> exists ----------
await part("4. Dev tools", async () => {
  const { page, uid } = await newAccount("dev");
  await page.click("#settingsBtn");
  await page.waitForTimeout(1000); // the page has asked about dev/<uid> by now
  ok(!(await vis(page, "#devSet")), "dev tools: hidden for a normal account");
  // Made by hand in the Firebase console, which the emulator's admin access stands in for.
  const r = await fetch(`${FS}/dev/${uid}`, { method: "PATCH", headers: OWNER, body: JSON.stringify({ fields: { role: { stringValue: "dev" } } }) });
  ok(r.ok, "dev tools: (dev/<uid> made with admin access)", String(r.status));
  await page.reload();
  await until(() => page.evaluate(() => document.body.classList.contains("ready") && !!window.__testAuth?.currentUser));
  await page.click("#settingsBtn");
  ok(await until(() => vis(page, "#devSet")), "dev tools: shown once dev/<uid> exists (read under the real rules)");
  await clean(page, "dev tools");
  await page.context().close();
});

// ---------- 5. Delete my account ----------
await part("5. Delete my account", async () => {
  const { page, uid } = await newAccount("delete");
  // Something in every place an account keeps things: history on (data/settings), sharing on and one shared answer (training).
  await until(() => vis(page, '#histAsk [data-hist="on"]'));
  await page.click('#histAsk [data-hist="on"]');
  await page.click("#settingsBtn"); await page.click("#shareToggle");
  await until(() => page.evaluate(() => document.querySelector("#shareAsk").open));
  await page.click("#shareYes"); await page.click("#settingsClose");
  await page.click('[data-set="samples-greetings"]'); await page.click("#dir-je"); await page.click("#startBtn");
  await until(() => vis(page, "#quiz"));
  await scribble(page); await page.click("#checkBtn");
  await until(() => vis(page, "#selfCheck"));
  await page.click("#selfGot"); await page.waitForTimeout(1500);
  await page.click("#quitBtn");
  const want = ["sets", "kanji", "meta", "data", "training"], cols = (d) => new Set(Object.keys(d).map((p) => p.split("/")[2]));
  const before = await until(async () => { const d = await docsOf(uid); return want.every((c) => cols(d).has(c)) && d; }) || await docsOf(uid);
  ok(want.every((c) => cols(before).has(c)), "delete: (the account has sets, kanji lists, meta, data and training)", [...cols(before)].join(", "));
  ok((await authUsers()).some((u) => u.localId === uid), "delete: (the account is in Auth)");
  await page.click("#settingsBtn"); await page.click("#delStart"); await page.click("#delYes");
  ok(await until(async () => !Object.keys(await docsOf(uid)).length), "delete: every document under users/<uid> is gone", Object.keys(await docsOf(uid)).join(", "));
  ok(await until(async () => !(await authUsers()).some((u) => u.localId === uid)), "delete: the account is deleted from Auth too");
  ok(await until(() => welcomeOpen(page)), "delete: the page starts over at the welcome pop-up");
  await page.waitForTimeout(1500);
  ok(!Object.keys(await docsOf(uid)).length, "delete: nothing is written back afterwards", Object.keys(await docsOf(uid)).join(", "));
  await clean(page, "delete");
  await page.context().close();
});

// ---------- 6. the rules, over REST with made-up sign-in tokens ----------
await part("6. Rules", async () => {
  await clearEmulators();
  // An unsigned ID token: the emulator reads it without checking a signature.
  const token = (uid) => [{ alg: "none", typ: "JWT" }, { sub: uid, user_id: uid, iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: 1, exp: 9999999999, auth_time: 1, firebase: { sign_in_provider: "google.com" } }]
    .map((o) => Buffer.from(JSON.stringify(o)).toString("base64url")).join(".") + ".";
  const as = async (who, method, path, body) => (await fetch(`${FS}/${path}`, { method,
    headers: { "content-type": "application/json", ...(who === "admin" ? OWNER : who ? { Authorization: "Bearer " + token(who) } : {}) },
    body: body && JSON.stringify(body) })).status;
  const doc = { fields: { name: { stringValue: "A" } } };
  ok(await as("alice", "PATCH", "users/alice/sets/a", doc) === 200 && await as("alice", "PATCH", "users/alice/data/prefs", doc) === 200, "rules: Alice writes in her own folder");
  ok(await as("alice", "GET", "users/alice/sets/a") === 200 && await as("alice", "DELETE", "users/alice/data/prefs") === 200, "rules: Alice reads and deletes in her own folder");
  ok(await as("bob", "GET", "users/alice/sets/a") === 403 && await as("bob", "PATCH", "users/alice/sets/a", doc) === 403 && await as("bob", "DELETE", "users/alice/sets/a") === 403,
    "rules: Bob can't read, write or delete in Alice's folder");
  ok(await as(null, "GET", "users/alice/sets/a") === 403 && await as(null, "PATCH", "users/alice/sets/b", doc) === 403, "rules: signed out, nothing can be read or written");
  ok(await as("alice", "PATCH", "other/x", doc) === 403 && await as("alice", "GET", "other/x") === 403, "rules: nothing outside users/ and dev/ is open");
  ok(await as("admin", "PATCH", "dev/alice", { fields: { role: { stringValue: "dev" } } }) === 200, "rules: (dev/alice made with admin access)");
  ok(await as("alice", "GET", "dev/alice") === 200 && await as("bob", "GET", "dev/bob") === 404, "rules: each person can read their own dev/<uid> (not found if missing)");
  ok(await as("bob", "GET", "dev/alice") === 403 && await as(null, "GET", "dev/alice") === 403, "rules: nobody else can read it, signed in or out");
  ok(await as("alice", "PATCH", "dev/alice", doc) === 403 && await as("alice", "DELETE", "dev/alice") === 403 && await as("bob", "PATCH", "dev/bob", doc) === 403,
    "rules: dev/<uid> is never writable from the site, not even one's own");
});

await browser.close(); server.close();
console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);

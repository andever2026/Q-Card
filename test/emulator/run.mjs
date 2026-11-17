// Browser tests for the public site (index.html) against the real Firebase SDK and the real firestore.rules, on the Firebase
// emulators (Auth and Firestore). test/public/run.mjs covers the page with an in-memory fake; these catch what a fake can't:
// what Firestore really accepts and refuses, the rules themselves, and the SDK's own behaviour.
// src/account/firebase.js is bundled as is, except that it connects to the emulators, uses the project demo-qcard (so nothing
// can reach the real project) and signs in with a made-up Google account instead of Google's pop-up.
// Run (needs firebase-tools and Java 21, and Playwright like test/public; PLAYWRIGHT_DIR overrides where it lives):
//   npx firebase emulators:exec --config test/emulator/firebase.json --only auth,firestore --project demo-qcard "node test/emulator/run.mjs"
// or start the emulators once with emulators:start and the same options, then run node test/emulator/run.mjs as often as you like.
// PARTS=6,7 (or any list of part numbers) runs only those parts.
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
// Every document under a path (a group, say), at any depth, by path.
async function docsAt(path) {
  const r = await fetch(`${FS}/${path}:runQuery`, { method: "POST", headers: OWNER, body: JSON.stringify({ structuredQuery: { from: [{ allDescendants: true }] } }) });
  if (!r.ok) throw new Error(`query ${path}: ${r.status}`);
  return Object.fromEntries((await r.json()).filter((x) => x.document).map(({ document: d }) => [d.name.split("/documents/")[1], fromFields(d.fields)]));
}
const docsOf = (uid) => docsAt(`users/${uid}`);
const authUsers = async () => (await (await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, { method: "POST", headers: OWNER, body: "{}" })).json()).userInfo || [];

// ---------- the page ----------
// src/account/firebase.js and src/checking/checker.js, as tools/build.mjs bundles them, with firebase/auth, firebase/firestore and
// ./config.js wrapped: the real SDK, connected to the emulators. window.__googleUser is who "Google" signs in.
const CONFIG = join(root, "src/account/config.js");
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
  config: `import config from ${JSON.stringify(CONFIG)}; export default { ...config, projectId: "${PROJECT}" };`,
};
let wrapped = false; // set when the page's own import of its config got the one above
const emulate = { name: "emulators", setup(b) {
  // The shims' own imports of the SDK resolve as usual (onResolve returns nothing for them).
  b.onResolve({ filter: /^firebase\/(auth|firestore)$/ }, (a) => (a.namespace === "emu" ? undefined : { path: a.path, namespace: "emu" }));
  b.onResolve({ filter: /^\.\/config\.js$/ }, (a) => (join(a.resolveDir, a.path) === CONFIG ? (wrapped = true, { path: "config", namespace: "emu" }) : undefined));
  b.onLoad({ filter: /.*/, namespace: "emu" }, (a) => ({ contents: shims[a.path], resolveDir: root, loader: "js" }));
} };
const entry = ['import "./src/account/firebase.js";', ...(existsSync(join(root, "src/checking/checker.js")) ? ['import "./src/checking/checker.js";'] : [])];
const platformJs = (await esbuild.build({
  stdin: { contents: entry.join("\n"), resolveDir: root, sourcefile: "emulator-entry.js" },
  bundle: true, format: "iife", write: false, plugins: [emulate],
})).outputFiles[0].text;
if (!wrapped) { console.error(`The page didn't import ${CONFIG}, so it would run as the real project. Nothing was started.`); process.exit(1); }

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
// Sign in with Google from the welcome pop-up; the page reloads into the account (see src/page/boot.js). Gives the uid.
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
// Make the account a developer: dev/<uid>, made by hand in the Firebase console, which the emulator's admin access stands in
// for. The page reads it when it loads, so it reloads.
async function makeDev(page, uid) {
  const r = await fetch(`${FS}/dev/${uid}`, { method: "PATCH", headers: OWNER, body: JSON.stringify({ fields: { role: { stringValue: "dev" } } }) });
  await page.reload();
  await until(() => page.evaluate(() => document.body.classList.contains("ready") && !!window.__testAuth?.currentUser));
  return r.ok;
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
// Signed in, Settings opens from the account menu at the top right (src/account/menu.js).
async function openSettings(page) { await page.click("#acctBtn"); await page.click('#acctList [data-acct="settings"]'); }
// Yes to sharing handwriting, then the birth month and year its second pop-up asks for.
async function sayYes(page) { await page.click("#shareYes"); for (const [k, v] of [["M", "01"], ["Y", "1990"]]) { await page.click(`#bornAskIn${k} .dd-btn`); await page.click(`#bornAskIn${k} li[data-v="${v}"]`); } await page.click("#bornAskGo"); await page.click("#askYes"); }
// One part of the tests; an exception fails it and the rest still run. PARTS=6,7 runs only those parts.
async function part(name, fn) {
  if (process.env.PARTS && !process.env.PARTS.split(",").includes(name.split(".")[0])) return;
  console.log(`\n${name}`);
  try { await fn(); } catch (e) { ok(false, `${name}: stopped early`, e.message.split("\n")[0]); }
}

// ---------- 1. first visit, sign in: sample sets and choices land in the account ----------
await part("1. First visit and sign in", async () => {
  await clearEmulators();
  const page = await openSite("first");
  ok(await until(() => welcomeOpen(page)), "first visit: the welcome pop-up opens");
  const uid = await signIn(page);
  await openSettings(page);
  ok(!!uid && /first@example\.com/.test(await text(page, "#acctName")), "sign in with Google (Auth emulator): the page reloads into the account", await text(page, "#acctName"));
  await page.click("#settingsClose");
  await openSettings(page); await page.click('#setNav [data-set-tab="account"]'); await page.fill("#nickIn", "Kumo"); await page.click("#nickSave");
  const prof = await until(async () => { const p = await getDoc(`users/${uid}/data/profile`); return p?.nickname === "Kumo" && p; });
  ok(!!prof && (await text(page, "#acctLabel")) === "Kumo", "nickname: saved to users/<uid>/data/profile (the rules allow it) and shown at the top right", JSON.stringify(prof || {}));
  await page.click("#settingsClose");
  const d = await until(async () => { const d = await docsOf(uid); return d[`users/${uid}/meta/samples`] && d; });
  const ids = (col) => Object.keys(d || {}).filter((p) => p.startsWith(`users/${uid}/${col}/samples-`));
  ok(ids("sets").length === 6 && ids("kanji").length === 3 && !!d?.[`users/${uid}/meta/samples`]?.offeredAt,
    "samples: 6 sample sets and 3 kanji lists saved in the account, the offer recorded in meta/samples", Object.keys(d || {}).map((p) => p.split("/").slice(2).join("/")).join(", "));
  ok(await until(() => vis(page, '[data-set="samples-greetings"]')), "samples: the page lists them");
  await page.click('[data-set="samples-food"]'); await page.click("#dir-je"); await page.click("#mode-kana");
  await openSettings(page); await page.click('#setNav [data-set-tab="look"]'); await page.click('#themePick [data-theme-pick="dark"]'); await page.click("#settingsClose");
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

// ---------- 3. sharing handwriting (developers only for now): each checked answer saved to training/, Settings deletes them ----------
await part("3. Sharing handwriting", async () => {
  const { page, uid } = await newAccount("share");
  await openSettings(page);
  await page.waitForTimeout(1000); // the page has asked about dev/<uid> by now
  ok(!(await vis(page, "#shareSet")), "share: not offered to an account that isn't a developer");
  await page.click("#settingsClose");
  ok(await makeDev(page, uid), "share: (dev/<uid> made with admin access)");
  await openSettings(page); await page.click('#setNav [data-set-tab="account"]'); // the tab is listed once the page knows this is a developer
  ok(await until(() => vis(page, "#shareSet")) && /Change your mind at any time/.test(await text(page, "#shareInfo")), "share: offered to a developer, off to begin with", await text(page, "#shareInfo"));
  await page.click("#shareToggle");
  await until(() => page.evaluate(() => document.querySelector("#shareAsk").open));
  await sayYes(page);
  await page.click("#settingsClose");
  ok(!!(await until(async () => (await getDoc(`users/${uid}/data/prefs`))?.share?.on === true)), "share: Settings → Turn on… → Yes is saved in the account's prefs");
  ok((await getDoc(`users/${uid}/data/profile`))?.born === "1990-01", "share: the birth month and year given with the yes is saved to users/<uid>/data/profile (the rules allow it)");
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
  await page.waitForTimeout(1500); // a right answer, then the next question
  await page.click("#quitBtn");
  await openSettings(page); await page.click('#setNav [data-set-tab="account"]');
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
  await openSettings(page);
  await page.waitForTimeout(1000); // the page has asked about dev/<uid> by now
  ok(!(await vis(page, '[data-set-tab="admin"]')), "admin: no Admin tab for a normal account");
  await page.click("#settingsClose");
  ok(await makeDev(page, uid), "dev tools: (dev/<uid> made with admin access)");
  await openSettings(page);
  await page.click('#setNav [data-set-tab="admin"]'); // listed once the page knows this is a developer
  ok(await until(() => vis(page, "#devSet")), "admin: the Admin tab is there once dev/<uid> exists (read under the real rules)");
  await clean(page, "dev tools");
  await page.context().close();
});

// ---------- 5. Delete my account ----------
await part("5. Delete my account", async () => {
  const { page, uid } = await newAccount("delete");
  // Something in every place an account keeps things: history on (data/settings), sharing on and one shared answer (training,
  // which only developers can turn on for now).
  await makeDev(page, uid);
  // Progress tracking is asked about on the Progress page (from the menu, behind ☰ on a narrower window).
  if (!(await page.locator('#sideNav [data-go="history"]').isVisible())) { await page.click("#menuBtn"); await page.waitForTimeout(300); }
  await page.click('#sideNav [data-go="history"]');
  await until(() => vis(page, '#hEmpty [data-hist="on"]'));
  await page.click('#hEmpty [data-hist="on"]');
  await openSettings(page); await page.click('#setNav [data-set-tab="account"]'); await page.click("#shareToggle");
  await until(() => page.evaluate(() => document.querySelector("#shareAsk").open));
  await sayYes(page); await page.click("#settingsClose"); // back to Progress, where Settings was opened
  if (!(await page.locator('#sideNav [data-go="setup"]').isVisible())) { await page.click("#menuBtn"); await page.waitForTimeout(300); }
  await page.click('#sideNav [data-go="setup"]');
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
  await openSettings(page); await page.click('#setNav [data-set-tab="account"]'); await page.click("#delStart"); await page.click("#delYes");
  ok(await until(async () => !Object.keys(await docsOf(uid)).length), "delete: every document under users/<uid> is gone", Object.keys(await docsOf(uid)).join(", "));
  ok(await until(async () => !(await authUsers()).some((u) => u.localId === uid)), "delete: the account is deleted from Auth too");
  ok(await until(() => welcomeOpen(page)), "delete: the page starts over at the welcome pop-up");
  await page.waitForTimeout(1500);
  ok(!Object.keys(await docsOf(uid)).length, "delete: nothing is written back afterwards", Object.keys(await docsOf(uid)).join(", "));
  await clean(page, "delete");
  await page.context().close();
});

// ---------- the rules over REST, with made-up sign-in tokens (parts 6 and 7) ----------
// An unsigned ID token: the emulator reads it without checking a signature. who is an account id, or [id, email] for an
// account signed in with that email (as Google gives it, checked), or [id, email, false] for one whose email isn't checked.
const token = (who) => { const [uid, email, checked = true] = [who].flat(); return [{ alg: "none", typ: "JWT" }, { sub: uid, user_id: uid, iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: 1, exp: 9999999999, auth_time: 1,
  firebase: { sign_in_provider: "google.com" }, ...(email && { email, email_verified: checked }) }].map((o) => Buffer.from(JSON.stringify(o)).toString("base64url")).join(".") + "."; };
const headersOf = (who) => ({ "content-type": "application/json", ...(who === "admin" ? OWNER : who ? { Authorization: "Bearer " + token(who) } : {}) });
const as = async (who, method, path, body) => (await fetch(`${FS}/${path}`, { method, headers: headersOf(who), body: body && JSON.stringify(body) })).status;
// Several writes at once, as a batch: [path, document] to set one, [path] to delete it.
const together = async (who, writes) => (await fetch(`${FS}:commit`, { method: "POST", headers: headersOf(who), body: JSON.stringify({ writes: writes.map(([path, body]) => {
  const name = `projects/${PROJECT}/databases/(default)/documents/${path}`; return body ? { update: { name, fields: body.fields } } : { delete: name }; }) }) })).status;
// A query for the documents of collection id under parent ("" for the top) whose field equals value.
const where = async (who, parent, id, field, value) => (await fetch(`${FS}${parent && "/" + parent}:runQuery`, { method: "POST", headers: headersOf(who),
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: id }], ...(field && { where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value } } }) } }) })).status;
const str = (v) => ({ stringValue: v });

// ---------- 6. the rules, over REST with made-up sign-in tokens ----------
await part("6. Rules", async () => {
  await clearEmulators();
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
  // Shared notebooks: shareOwners/<id> says whose a shared copy is, shares/<id> and what's under it is the copy.
  const sid = "abcdefghijkmnopqrstuvwxy";
  const own = (uid) => ({ fields: { uid: str(uid), nb: str("main"), createdAt: str("x") } }), info = (more = {}) => ({ fields: { name: str("My notebook"), rev: { arrayValue: { values: [str("sets/a 1.1")] } }, updatedAt: str("x"), ...more } });
  ok(await as("alice", "PATCH", "shareOwners/short", own("alice")) === 403 && await as("alice", "PATCH", `shareOwners/${sid}`, own("bob")) === 403 && await as(null, "PATCH", `shareOwners/${sid}`, own("alice")) === 403,
    "rules: a share can't be made under a short id, in somebody else's name, or signed out");
  ok(await as("alice", "PATCH", `shares/${sid}`, info()) === 403, "rules: nothing can be written to a share nobody owns");
  ok(await as("alice", "PATCH", `shareOwners/${sid}`, own("alice")) === 200 && await as("alice", "PATCH", `shares/${sid}`, info()) === 200 && await as("alice", "PATCH", `shares/${sid}/sets/a`, doc) === 200
    && await as("alice", "PATCH", `shares/${sid}/kanji/k`, doc) === 200 && await as("alice", "PATCH", `shares/${sid}/meta/books`, doc) === 200, "rules: Alice makes a share and writes its copy (sets, kanji, meta)");
  ok(await as("bob", "PATCH", `shareOwners/${sid}`, own("bob")) === 403 && await as("alice", "PATCH", `shareOwners/${sid}`, own("alice")) === 403, "rules: whose a share is can't be changed afterwards, by anyone");
  ok(await as("alice", "GET", `shareOwners/${sid}`) === 200 && await as("bob", "GET", `shareOwners/${sid}`) === 403 && await as(null, "GET", `shareOwners/${sid}`) === 403, "rules: only its owner can read whose a share is");
  ok(await as("alice", "PATCH", `shares/${sid}`, info({ owner: str("alice") })) === 403 && await as("alice", "PATCH", `shares/${sid}`, info({ name: str("x".repeat(101)) })) === 403 && await as("alice", "PATCH", `shares/${sid}/other/a`, doc) === 403,
    "rules: a share holds only its name, what it has and when, and only sets, kanji and meta under it");
  ok(await as("bob", "PATCH", `shares/${sid}`, info()) === 403 && await as("bob", "PATCH", `shares/${sid}/sets/a`, doc) === 403 && await as("bob", "DELETE", `shares/${sid}/sets/a`) === 403
    && await as(null, "PATCH", `shares/${sid}/sets/b`, doc) === 403 && await as("bob", "DELETE", `shares/${sid}`) === 403 && await as("bob", "DELETE", `shareOwners/${sid}`) === 403, "rules: nobody but its owner can write or delete any of a share");
  ok(await as(null, "GET", `shares/${sid}`) === 200 && await as(null, "GET", `shares/${sid}/sets/a`) === 200 && await as(null, "GET", `shares/${sid}/sets`) === 200 && await as("bob", "GET", `shares/${sid}/meta/books`) === 200,
    "rules: anyone who has a share's id can read it, signed in or not");
  ok(await as(null, "GET", "shares") === 403 && await as("bob", "GET", "shares") === 403 && await as("bob", "GET", "shareOwners") === 403, "rules: shares can't be listed, so a share is found only by its link");
  // Reports and Take down. Bob shares a notebook; Dana is a developer; Carol is neither.
  const sid2 = "zyxwvutsrqponmkjihgfedcb", rep = (by, more = {}) => ({ fields: { share: str(sid2), why: str("rights"), note: str("from a textbook"), at: str("2026-11-17T00:00:00.000Z"), by: str(by), ...more } }), down = { fields: { at: str("2026-11-17T00:00:00.000Z") } };
  ok(await as("admin", "PATCH", "dev/dana", { fields: { role: str("dev") } }) === 200 && await as("bob", "PATCH", `shareOwners/${sid2}`, own("bob")) === 200 && await as("bob", "PATCH", `shares/${sid2}`, info()) === 200
    && await as("bob", "PATCH", `shares/${sid2}/sets/a`, doc) === 200, "rules: (dev/dana made with admin access; Bob shares a notebook)");
  ok(await as(null, "PATCH", "reports/r1", rep("alice")) === 403 && await as("alice", "PATCH", "reports/r1", rep("alice")) === 200 && await as("carol", "PATCH", "reports/r2", rep("carol", { why: str("other"), note: str("") })) === 200, "rules: anyone signed in can send a report about a shared notebook; signed out, nobody");
  ok(await as("carol", "PATCH", "reports/r3", rep("carol", { share: str("nobodysharedthisnobodyshared") })) === 403 && await as("carol", "PATCH", "reports/r3", rep("carol", { share: str("x/y") })) === 403 && await as("carol", "PATCH", "reports/r3", rep("carol", { why: str("spam") })) === 403 && await as("carol", "PATCH", "reports/r3", rep("carol", { why: str("wrong") })) === 200 && await as("dana", "DELETE", "reports/r3") === 200
    && await as("carol", "PATCH", "reports/r3", rep("carol", { note: str("x".repeat(1001)) })) === 403 && await as("carol", "PATCH", "reports/r3", rep("carol", { more: str("x") })) === 403 && await as("carol", "PATCH", "reports/r1", rep("carol")) === 403,
    "rules: a report is about a notebook that is shared, with one of the reasons, a note of 1000 characters at most and nothing else, and can't be changed afterwards");
  const { by: _by, ...noBy } = rep("carol").fields;
  ok(await as("carol", "PATCH", "reports/r4", rep("alice")) === 403 && await as("carol", "PATCH", "reports/r4", { fields: noBy }) === 403, "rules: a report says it's from the account sending it, and from no other");
  // The account that sent reports can list its own (and only by asking for those), and take itself off them; nothing else.
  // (Carol's r2: Alice is a developer here.)
  const theirs = (who, by) => where(who, "", "reports", "by", str(by));
  const r2 = (more = {}) => ({ fields: { ...rep("carol", { why: str("other"), note: str("") }).fields, ...more } }), gone = (more = {}) => r2({ by: { nullValue: null }, ...more });
  const seen = [await theirs("carol", "carol"), await theirs("bob", "carol"), await as("carol", "GET", "reports/r2")].join();
  ok(seen === "200,403,403", "rules: an account can list the reports it sent, not anyone else's, and can't read them one by one", seen);
  ok(await as("bob", "PATCH", "reports/r2", gone()) === 403 && await as("carol", "PATCH", "reports/r2", gone({ note: str("changed") })) === 403 && await as("carol", "PATCH", "reports/r2", r2({ by: str("bob") })) === 403
    && await as("carol", "PATCH", "reports/r2", gone()) === 200 && await as("carol", "PATCH", "reports/r2", gone()) === 403 && await theirs("carol", "carol") === 200,
    "rules: the account that sent a report can take itself off it (for when it's deleted), and change nothing else; then it's no longer theirs");
  ok(await as(null, "GET", "reports/r1") === 403 && await as("carol", "GET", "reports/r2") === 403 && await as("bob", "GET", "reports") === 403 && await as("carol", "DELETE", "reports/r1") === 403
    && await as("dana", "GET", "reports") === 200 && await as("dana", "GET", "reports/r1") === 200, "rules: only a developer can read reports");
  ok(await as("bob", "PATCH", `takedowns/${sid2}`, down) === 403 && await as("carol", "PATCH", `takedowns/${sid2}`, down) === 403 && await as(null, "PATCH", `takedowns/${sid2}`, down) === 403
    && await as("dana", "PATCH", `takedowns/${sid2}`, { fields: { ...down.fields, by: str("dana") } }) === 403 && await as(null, "GET", `shares/${sid2}`) === 200, "rules: nobody but a developer can take a notebook down, and a takedown holds only its time");
  ok(await as("dana", "PATCH", `takedowns/${sid2}`, down) === 200 && await as(null, "GET", `shares/${sid2}`) === 403 && await as("carol", "GET", `shares/${sid2}/sets/a`) === 403 && await as(null, "GET", `shares/${sid2}/sets`) === 403,
    "rules: once a developer takes it down, the shared copy can't be read by people who have the link");
  ok(await as("bob", "GET", `shares/${sid2}`) === 200 && await as("bob", "GET", `shares/${sid2}/sets`) === 200 && await as("bob", "PATCH", `shares/${sid2}/sets/a`, doc) === 200 && await as("dana", "GET", `shares/${sid2}`) === 200 && await as("dana", "GET", `shares/${sid2}/sets/a`) === 200,
    "rules: its owner and developers still can (the owner can still change or delete it)");
  ok(await as(null, "GET", `takedowns/${sid2}`) === 200 && await as(null, "GET", "takedowns") === 403 && await as("carol", "GET", "takedowns") === 403 && await as("dana", "GET", "takedowns") === 200 && await as(null, "GET", `shares/${sid}`) === 200,
    "rules: anyone can ask whether one notebook is taken down, only developers can list them, and other shared notebooks are untouched");
  ok(await as("bob", "DELETE", `takedowns/${sid2}`) === 403 && await as("carol", "DELETE", `takedowns/${sid2}`) === 403 && await as("dana", "DELETE", `takedowns/${sid2}`) === 200 && await as(null, "GET", `shares/${sid2}`) === 200,
    "rules: only a developer can put it back; then the link works again");
  // The Browse page's lines (listed/<id>).
  const line = (more = {}) => ({ fields: { name: str("A"), about: str(""), sets: { integerValue: "1" }, words: { integerValue: "2" }, updatedAt: str("x"), ...more } });
  ok(await as("carol", "PATCH", `listed/${sid2}`, line()) === 403 && await as(null, "PATCH", `listed/${sid2}`, line()) === 403 && await as("dana", "PATCH", `listed/${sid2}`, line()) === 403
    && await as("bob", "PATCH", "listed/nobodysharedthisnobodyshared", line()) === 403, "rules: nobody but its owner can list a shared notebook on Browse, and only a notebook that is shared");
  ok(await as("bob", "PATCH", `listed/${sid2}`, line({ owner: str("bob") })) === 403 && await as("bob", "PATCH", `listed/${sid2}`, line({ about: str("x".repeat(201)) })) === 403 && await as("bob", "PATCH", `listed/${sid2}`, line({ sets: str("1") })) === 403,
    "rules: a line holds only the name, a line about it of 200 characters at most, the counts and the time");
  ok(await as("bob", "PATCH", `listed/${sid2}`, line()) === 200 && await as(null, "GET", `listed/${sid2}`) === 200 && await as(null, "GET", "listed") === 200 && await as("carol", "GET", "listed") === 200
    && await as("carol", "DELETE", `listed/${sid2}`) === 403 && await as(null, "DELETE", `listed/${sid2}`) === 403, "rules: the owner lists it; anyone can read Browse's lines, signed in or not, and nobody else can remove one");
  ok(await as("dana", "PATCH", `takedowns/${sid2}`, down) === 200 && await as("bob", "PATCH", `listed/${sid2}`, line()) === 403 && await as("dana", "DELETE", `listed/${sid2}`) === 200 && await as("bob", "PATCH", `listed/${sid2}`, line()) === 403
    && await as("dana", "DELETE", `takedowns/${sid2}`) === 200 && await as("bob", "PATCH", `listed/${sid2}`, line()) === 200 && await as("bob", "DELETE", `listed/${sid2}`) === 200,
    "rules: taken down, a developer removes its line and the owner can't list it again until it's put back");
  ok(await as("dana", "DELETE", "reports/r1") === 200 && await as("dana", "DELETE", "reports/r2") === 200 && await as("dana", "GET", "reports/r1") === 404, "rules: a developer deletes reports");
  ok(await as("alice", "DELETE", `shares/${sid}/sets/a`) === 200 && await as("alice", "DELETE", `shares/${sid}`) === 200 && await as("alice", "DELETE", `shareOwners/${sid}`) === 200 && await as(null, "GET", `shares/${sid}`) === 404,
    "rules: the owner deletes a share, and then the link finds nothing");
});

// ---------- 7. groups: the rules, over REST ----------
// Olga makes a group; Mo, Ivy, Max, Ann and Rae join by its link and Olga gives them roles; Req asks to join; Eve is invited
// by email; Out is in no group.
await part("7. Group rules", async () => {
  await clearEmulators();
  const G = "g1", at = (p = "") => `groups/${G}${p}`, T1 = "aaaaaaaaaaaaaaaaaaaaaaaa", T2 = "bbbbbbbbbbbbbbbbbbbbbbbb", T3 = "cccccccccccccccccccccccc", eve = ["eve", "Eve@Example.com"];
  const bool = (v) => ({ booleanValue: v }), map = (o) => ({ mapValue: { fields: o } }), doc = { fields: { name: str("A") } };
  const role = (name, ...yes) => ({ fields: { name: str(name), perms: map(Object.fromEntries(["edit", "notebooks", "share", "invite", "approve", "members", "roles"].map((p) => [p, bool(yes.includes(p))]))) } });
  const group = (owner, link = null, name = "Study group") => ({ fields: { name: str(name), owner: str(owner), createdAt: str("x"),
    link: link ? map({ token: str(link[0]), role: str(link[1]), approve: bool(link[2]) }) : { nullValue: null } } });
  const member = (name, r, via = T1) => ({ fields: { name: str(name), role: str(r), joinedAt: str("x"), via: str(via) } });
  // Making one
  ok(await together("olga", [[at(), group("mo")], [at("/members/olga"), member("Olga", "owner", "")]]) === 403 && await together("mo", [[at(), group("olga")], [at("/members/mo"), member("Mo", "owner", "")]]) === 403
    && await as("olga", "PATCH", at(), group("olga", [T1, "member", false])) === 403, "groups: a group is made in its maker's own name, with no link yet");
  ok(await together("olga", [[at(), group("olga")], [at("/members/olga"), member("Olga", "owner", "")], [at("/roles/member"), role("Member")], [at("/roles/editor"), role("Editor", "edit")]]) === 200,
    "groups: Olga makes a group, her owner line and its starting roles (Member, Editor) in one go");
  ok(await as("mo", "PATCH", at("/members/mo"), member("Mo", "owner", "")) === 403 && await as("mo", "PATCH", at("/roles/x"), role("X")) === 403 && await as("olga", "PATCH", at("/roles/owner"), role("Owner")) === 403,
    "groups: nobody else can make themselves its owner or add a role to it, and no role can be called owner");
  ok(await as("olga", "GET", at()) === 200 && await as("out", "GET", at()) === 403 && await as(null, "GET", at()) === 403 && await as("out", "GET", at("/members")) === 403 && await as("out", "GET", at("/roles/member")) === 403
    && await as("olga", "GET", "groups") === 403, "groups: only people in a group can read it, and groups can't be listed");
  // Joining by link
  const linkPage = (r, approve, g = G) => ({ fields: { group: str(g), name: str("Study group"), role: str(r), approve: bool(approve) } });
  ok(await as("olga", "PATCH", at(), group("olga", [T1, "member", false])) === 200 && await as("olga", "PATCH", `groupLinks/${T1}`, linkPage("member", false)) === 200 && await as(null, "GET", `groupLinks/${T1}`) === 200,
    "groups: Olga sets a join link; anyone who has it can see which group it's for");
  ok(await as("out", "PATCH", at("/members/out"), member("Out", "member", T2)) === 403 && await as("out", "PATCH", at("/members/out"), member("Out", "editor")) === 403 && await as("out", "PATCH", at("/members/out"), member("Out", "owner")) === 403,
    "groups: joining takes the link's own token, and gives only the link's role");
  const joined = await Promise.all(["mo", "ivy", "max", "ann", "rae"].map((u) => as(u, "PATCH", at(`/members/${u}`), member(u, "member"))));
  ok(joined.every((s) => s === 200) && await as("mo", "GET", at()) === 200 && await as("mo", "GET", at("/members")) === 200 && await as("mo", "GET", at("/roles")) === 200,
    "groups: with the link, Mo, Ivy, Max, Ann and Rae join as Member and can read the group", joined.join());
  // Roles
  ok(await as("olga", "PATCH", at("/roles/inviter"), role("Inviter", "invite")) === 200 && await as("olga", "PATCH", at("/roles/manager"), role("Manager", "members")) === 200
    && await as("olga", "PATCH", at("/roles/approver"), role("Approver", "approve")) === 200 && await as("olga", "PATCH", at("/roles/rolemgr"), role("Roles", "roles", "edit")) === 200
    && await as("olga", "PATCH", at("/members/ivy"), member("ivy", "inviter")) === 200 && await as("olga", "PATCH", at("/members/max"), member("max", "manager")) === 200
    && await as("olga", "PATCH", at("/members/ann"), member("ann", "approver")) === 200 && await as("olga", "PATCH", at("/members/rae"), member("rae", "rolemgr")) === 200,
    "groups: the owner makes roles and gives them to people");
  ok(await as("mo", "PATCH", at("/members/mo"), member("Momo", "member")) === 200 && await as("mo", "PATCH", at("/members/mo"), member("Momo", "editor")) === 403 && await as("mo", "PATCH", at("/members/ivy"), member("Not Ivy", "inviter")) === 403,
    "groups: each person can change their own name in a group, not their role or anyone else's name");
  ok(await as("rae", "PATCH", at("/roles/helper"), role("Helper", "edit")) === 200 && await as("rae", "PATCH", at("/roles/boss"), role("Boss", "members")) === 403 && await as("rae", "PATCH", at("/roles/editor"), role("Writer", "edit")) === 200
    && await as("rae", "PATCH", at("/roles/manager"), role("Manager", "roles")) === 403 && await as("rae", "DELETE", at("/roles/helper")) === 200 && await as("rae", "DELETE", at("/roles/manager")) === 403
    && await as("mo", "DELETE", at("/roles/editor")) === 403, "groups: Manage roles makes, changes and deletes only roles with no permission they don't have themselves");
  ok(await as("max", "PATCH", at("/members/mo"), member("Momo", "editor")) === 403 && await as("max", "PATCH", at("/members/rae"), member("rae", "member")) === 403 && await as("max", "PATCH", at("/members/olga"), member("Olga", "member", "")) === 403
    && await as("max", "PATCH", at("/members/max"), member("max", "inviter")) === 403, "groups: Manage members can't give a role with a permission they don't have, change someone whose role has one, touch the owner or change their own role");
  ok(await as("max", "DELETE", at("/members/mo")) === 200 && await as("mo", "GET", at()) === 403 && await as("mo", "PATCH", at("/members/mo"), member("Mo", "member")) === 200 && await as("max", "DELETE", at("/members/rae")) === 403 && await as("max", "DELETE", at("/members/olga")) === 403,
    "groups: Manage members removes people whose role they could give (who can join again while the link works), nobody else");
  // Invite
  ok(await as("ivy", "PATCH", at(), group("olga", [T2, "editor", false])) === 403 && await as("ivy", "PATCH", at(), group("olga", [T1, "member", false], "Renamed")) === 403 && await as("mo", "PATCH", at(), group("olga", [T2, "member", true])) === 403
    && await as("ivy", "PATCH", at(), group("olga", [T2, "member", true])) === 200, "groups: Invite sets the link, with a role no stronger than their own, and nothing else about the group");
  ok(await as("ivy", "PATCH", `groupLinks/${T2}`, linkPage("member", true)) === 200 && await as("out", "PATCH", `groupLinks/${T3}`, linkPage("member", false)) === 403
    && await as("ivy", "PATCH", `groupLinks/${T3}`, linkPage("editor", false)) === 403 && await as("ivy", "PATCH", `groupLinks/${T1}`, linkPage("member", false, "g2")) === 403 && await as("ivy", "DELETE", `groupLinks/${T1}`) === 200,
    "groups: a link's page is made by whoever may invite, with a role they could give, and can't be moved to another group");
  // Asking to join, once the link asks for approval
  const ask = (r = "member", t = T2) => ({ fields: { name: str("Req"), role: str(r), token: str(t), at: str("x") } });
  ok(await as("req", "PATCH", at("/members/req"), member("Req", "member", T2)) === 403 && await as("req", "PATCH", at("/members/req"), member("Req", "member", T1)) === 403
    && await as("req", "PATCH", at("/requests/req"), ask("editor")) === 403 && await as("req", "PATCH", at("/requests/req"), ask("member", T1)) === 403 && await as("mo", "PATCH", at("/requests/mo"), ask()) === 403,
    "groups: a link that asks for approval (and the old link) lets nobody straight in; a request takes the link's own token and role, from someone not in the group");
  ok(await as("req", "PATCH", at("/requests/req"), ask()) === 200 && await as("req", "GET", at("/requests/req")) === 200 && await as("req", "GET", at()) === 403
    && await where("mo", at(), "requests") === 403 && await where("ann", at(), "requests") === 200 && await as("out", "GET", at("/requests/req")) === 403,
    "groups: Req asks to join; Req can see the request, Approve requests sees them all, nobody else does");
  ok(await as("mo", "PATCH", at("/members/req"), member("Req", "member", "approved")) === 403 && await as("ann", "PATCH", at("/members/req"), member("Req", "editor", "approved")) === 403
    && await as("ann", "PATCH", at("/members/req"), member("Req", "member", "approved")) === 200 && await as("ann", "DELETE", at("/requests/req")) === 200 && await as("req", "GET", at()) === 200,
    "groups: Approve requests lets Req in, with the role Req asked with");
  // Invites by email
  const invite = (email, r = "editor", id = `${G}_${email}`) => [`groupMail/${id}`, { fields: { group: str(G), name: str("Study group"), email: str(email), role: str(r), by: str("Olga"), at: str("x") } }];
  ok(await as("out", "PATCH", ...invite("out@example.com", "member")) === 403 && await as("olga", "PATCH", ...invite("Eve@Example.com")) === 403 && await as("olga", "PATCH", ...invite("eve@example.com", "editor", `${G}_someone@example.com`)) === 403
    && await as("ivy", "PATCH", ...invite("eve@example.com")) === 403 && await as("ivy", "PATCH", ...invite("friend@example.com", "member")) === 200,
    "groups: an email invite comes from someone in the group who may invite, to the address in lowercase, with a role they could give");
  ok(await as("olga", "PATCH", ...invite("eve@example.com")) === 200 && await where(eve, "", "groupMail", "email", str("eve@example.com")) === 200 && await where("out", "", "groupMail", "email", str("eve@example.com")) === 403
    && await where(["out", "out@example.com"], "", "groupMail", "email", str("eve@example.com")) === 403 && await as("out", "GET", invite("eve@example.com")[0]) === 403, "groups: whoever signs in with that email finds the invite; nobody else can");
  ok(await where("olga", "", "groupMail", "group", str(G)) === 200 && await where("ivy", "", "groupMail", "group", str(G)) === 200 && await where("mo", "", "groupMail", "group", str(G)) === 403
    && await where("out", "", "groupMail", "group", str(G)) === 403 && await where("olga", "", "groupMail") === 403, "groups: whoever may invite lists the group's invites; nobody else, and not all of them");
  ok(await as(["mal", "eve@example.com", false], "PATCH", at("/members/mal"), member("Mal", "editor", "mail")) === 403 && await as(eve, "PATCH", at("/members/eve"), member("Eve", "inviter", "mail")) === 403
    && await as("out", "PATCH", at("/members/out"), member("Out", "editor", "mail")) === 403, "groups: an invite lets in only that email, once Google has checked it, with the invite's role");
  ok(await as(eve, "PATCH", at("/members/eve"), member("Eve", "editor", "mail")) === 200 && await as(eve, "DELETE", invite("eve@example.com")[0]) === 200 && await as(eve, "GET", at()) === 200, "groups: Eve joins by the invite, then takes it away");
  // The group's notebooks
  ok(await as("olga", "PATCH", at("/notebooks/n1"), doc) === 200 && await as(eve, "PATCH", at("/notebooks/n2"), doc) === 403 && await as("mo", "PATCH", at("/notebooks/n2"), doc) === 403 && await as("olga", "PATCH", at("/notebooks/n3"), { fields: { name: str("A"), owner: str("x") } }) === 403,
    "groups: only Manage notebooks (and the owner) makes a group notebook");
  ok(await as(eve, "PATCH", at("/notebooks/n1/sets/a"), doc) === 200 && await as(eve, "PATCH", at("/notebooks/n1/kanji/k"), doc) === 200 && await as(eve, "PATCH", at("/notebooks/n1/other/x"), doc) === 403
    && await as("mo", "PATCH", at("/notebooks/n1/sets/a"), doc) === 403 && await as("mo", "DELETE", at("/notebooks/n1/sets/a")) === 403 && await as("mo", "GET", at("/notebooks/n1/sets/a")) === 200 && await as("mo", "GET", at("/notebooks/n1/sets")) === 200
    && await as("out", "GET", at("/notebooks/n1/sets/a")) === 403, "groups: Edit notebooks changes what's in them; everyone in the group can read them, nobody outside it");
  // Sharing a group notebook by link
  const S = "sharedbythegroupsharedby", byGroup = { fields: { group: str(G), nb: str("n1"), createdAt: str("x") } };
  const info = { fields: { name: str("Group notebook"), rev: { arrayValue: { values: [] } }, updatedAt: str("x") } }, line = { fields: { name: str("A"), about: str(""), sets: { integerValue: "1" }, words: { integerValue: "2" }, updatedAt: str("x") } };
  ok(await as("mo", "PATCH", `shareOwners/${S}`, byGroup) === 403 && await as("out", "PATCH", `shareOwners/${S}`, byGroup) === 403 && await as("olga", "PATCH", `shareOwners/${S}`, { fields: { ...byGroup.fields, uid: str("olga") } }) === 403
    && await as("olga", "PATCH", `shareOwners/${S}`, byGroup) === 200, "groups: sharing a group notebook by link takes Share by link (or being the owner)");
  ok(await as("olga", "PATCH", `shares/${S}`, info) === 200 && await as(eve, "PATCH", `shares/${S}/sets/a`, doc) === 200 && await as("mo", "PATCH", `shares/${S}/sets/a`, doc) === 403 && await as(null, "GET", `shares/${S}/sets/a`) === 200
    && await as("olga", "PATCH", `listed/${S}`, line) === 403 && await as(eve, "DELETE", `shareOwners/${S}`) === 403 && await as("mo", "GET", `shareOwners/${S}`) === 403,
    "groups: its copy is kept up to date by whoever may share or edit, anyone with the link reads it, it can't go on Browse, and Stop sharing takes Share by link");
  ok(await as("olga", "PATCH", at("/roles/sharer"), role("Sharer", "share")) === 200 && await as("olga", "PATCH", at("/roles/keeper"), role("Keeper", "notebooks")) === 200
    && await as("olga", "PATCH", at("/members/max"), member("max", "sharer")) === 200 && await as("olga", "PATCH", at("/members/ann"), member("ann", "keeper")) === 200, "(Max may share by link, Ann may manage notebooks)");
  const nbLine = (share, name = "A") => ({ fields: { name: str(name), share: share ? str(share) : { nullValue: null } } });
  ok(await as("max", "PATCH", at("/notebooks/n1"), nbLine(S)) === 200 && await as("max", "PATCH", at("/notebooks/n1"), nbLine(S, "B")) === 403 && await as(eve, "PATCH", at("/notebooks/n1"), nbLine(null)) === 403
    && await as("ann", "PATCH", at("/notebooks/n1"), nbLine(null, "B")) === 200 && await as("ann", "PATCH", at("/notebooks/n1"), nbLine(S, "A")) === 200 && await as("ann", "PATCH", at("/notebooks/n1"), { fields: { name: str("A"), share: { integerValue: "1" } } }) === 403,
    "groups: a group notebook's line says it's shared (share): Share by link sets only that, Manage notebooks anything");
  ok(await as("ann", "PATCH", `shares/${S}/sets/b`, doc) === 200 && await as("ann", "GET", `shareOwners/${S}`) === 200 && await as("max", "GET", `shareOwners/${S}`) === 200,
    "groups: Manage notebooks keeps the shared copy up to date too, and can stop sharing it");
  // Handing it over, leaving, deleting
  ok(await as("olga", "PATCH", at(), group("eve", [T2, "member", true])) === 403 && await as(eve, "PATCH", at("/members/eve"), member("Eve", "owner", "mail")) === 403
    && await together("olga", [[at(), group("eve", [T2, "member", true])], [at("/members/eve"), member("Eve", "owner", "mail")]]) === 403
    && await together("olga", [[at(), group("out", [T2, "member", true])], [at("/members/out"), member("Out", "owner")], [at("/members/olga"), member("Olga", "editor", "")]]) === 403,
    "groups: the owner hands it over only to someone in the group, in one go with both their lines, and nobody can take it");
  ok(await together("olga", [[at(), group("eve", [T2, "member", true])], [at("/members/eve"), member("Eve", "owner", "mail")], [at("/members/olga"), member("Olga", "editor", "")]]) === 200
    && await as("olga", "PATCH", at(), group("olga", [T2, "member", true], "Mine")) === 403 && await as(eve, "PATCH", at(), group("eve", [T2, "member", true], "Eve's group")) === 200,
    "groups: Olga hands the group to Eve and becomes an Editor; now only Eve can rename it");
  ok(await as("mo", "DELETE", at("/members/mo")) === 200 && await as(eve, "DELETE", at("/members/olga")) === 200 && await as("olga", "GET", at()) === 403 && await as("olga", "DELETE", at()) === 403 && await as("ivy", "DELETE", at()) === 403,
    "groups: anyone can leave, the owner can remove anyone, and only the owner can delete the group");
  ok(await as(eve, "DELETE", at()) === 200, "groups: the owner deletes the group");
});

// ---------- 8. groups in the page, on the real SDK and rules: making one, its notebooks, moving one in, a member who can only read ----------
// Groups through the page: the notebook menu (☰ first: at this width the sidebar with it is a drawer), a name asked for,
// a group's settings from the gear by its name.
const menu = async (p, sel) => { await sleep(400); if (!(await p.locator("#nbBtn").isVisible())) { await p.click("#menuBtn"); await sleep(400); } await p.click("#nbBtn"); await until(() => p.$(`#nbList ${sel}`)); await p.click(`#nbList ${sel}`); };
const goTable = async (p) => { await sleep(400); if (!(await p.locator('#sideNav [data-go="table"]').isVisible())) { await p.click("#menuBtn"); await sleep(400); } await p.click('#sideNav [data-go="table"]'); };
const nameIt = async (p, name) => { await p.fill("#nbNameIn", name); await p.keyboard.press("Enter"); };
const gs = async (p, sel = '[data-nb-do="groupSettings"]') => { await menu(p, sel); await until(() => p.$("#gsBody")); };
const groupOf = async (uid) => (await until(async () => (await getDoc(`users/${uid}/meta/groups`))?.list?.[0]))?.id;

await part("8. Groups in the page", async () => {
  const { page, uid } = await newAccount("olga");
  await menu(page, '[data-nb-do="newGroup"]'); await nameIt(page, "Study group");
  const g = await groupOf(uid), at = (p = "") => `groups/${g}${p}`;
  ok(!!g && (await getDoc(at()))?.owner === uid && (await getDoc(at(`/members/${uid}`)))?.role === "owner" && (await getDoc(at("/roles/editor")))?.perms?.edit === true,
    "groups: New group makes the group, its owner line and its roles in one write the rules accept, and lists it in the account");
  await menu(page, '[data-nb-do="groupNb"]'); await nameIt(page, "Kana");
  const kana = await until(async () => Object.entries(await docsAt(at())).find(([p, d]) => /\/notebooks\/[^/]+$/.test(p) && d.name === "Kana")?.[0].split("/").at(-1));
  await until(async () => (await text(page, "#nbName")) === "Kana");
  await goTable(page);
  await page.fill("#nsCol", "Kana"); await page.fill("#nsUnit", "Week 1"); await page.fill("#nsName", "Vowels"); await page.click('#newSetForm [type="submit"]');
  ok(!!kana && !!(await until(async () => Object.entries(await docsAt(at())).some(([p, d]) => p.includes(`/notebooks/${kana}/sets/`) && d.name === "Vowels"))), "groups: a notebook made in the group, and a set added to it, are saved in the group");
  // Her first notebook (the sample sets) moved in: copied to the group, then emptied in the account.
  await menu(page, '[data-nb="main"]'); await until(async () => (await text(page, "#nbName")) === "My notebook");
  await menu(page, '[data-nb-do="moveToGroup"]'); await page.click("#askYes");
  const moved = await until(async () => { const d = await docsAt(at()), n = Object.entries(d).find(([p, x]) => /\/notebooks\/[^/]+$/.test(p) && x.name === "My notebook")?.[0]; return n && Object.keys(d).filter((p) => p.startsWith(n + "/sets/")).length === 6 && n; });
  const left = await until(async () => { const d = await docsOf(uid); return !Object.keys(d).some((p) => p.startsWith(`users/${uid}/sets/`)) && d; });
  ok(!!moved && !!left, "groups: Move to a group copies a notebook's sets into the group and takes them out of the account");
  // Mo is put in the group as a Member (with admin access, standing in for joining, which comes later): he can only read.
  const mo = await openSite("mo"), mid = await signIn(mo);
  await as("admin", "PATCH", at(`/members/${mid}`), { fields: { name: str("mo"), role: str("member"), joinedAt: str("x"), via: str("x") } });
  await as("admin", "PATCH", `users/${mid}/meta/groups`, { fields: { list: { arrayValue: { values: [{ mapValue: { fields: { id: str(g), name: str("Study group") } } }] } } } });
  await menu(mo, `[data-nb="${g}/${kana}"]`);
  await until(async () => (await text(mo, "#nbName")) === "Kana");
  await goTable(mo);
  const tried = await mo.evaluate(async ([g, n]) => { try { await window.qcardPlatform.group(g).db.doc(`notebooks/${n}/sets/x`).set({ name: "x" }); return "written"; } catch (e) { return e.code; } }, [g, kana]);
  ok(await until(() => vis(mo, "#tableRole")) && !(await vis(mo, "#newSetForm")) && tried === "permission-denied", "groups: a Member opens the group's notebook read only, and the rules refuse his writes", tried);
  // Group settings (src/groups/settings.js), with the real rules.
  await gs(page); await page.click(`[data-role-of="${mid}"] .dd-btn`); await page.click(`[data-role-of="${mid}"] li[data-v="editor"]`);
  ok(await until(async () => (await getDoc(at(`/members/${mid}`)))?.role === "editor") && await until(() => vis(mo, "#newSetForm")), "group settings: the owner makes Mo an Editor, and his open page lets him edit at once");
  // Taken out: the real listeners tell his page, which drops the group.
  await page.click(`[data-out="${mid}"]`); await page.click("#askYes");
  ok(await until(async () => /no longer in “Study group”/.test(await text(mo, "#banner")) && (await text(mo, "#nbName")) === "My notebook"), "groups: taken out of the group, his page says so and opens his own notebook");
  await until(() => page.$("#gsBody")); await page.click("#askYes");
  // Back in, he's handed the group; she takes his role, then leaves; he deletes it, with everything in it.
  await as("admin", "PATCH", at(`/members/${mid}`), { fields: { name: str("mo"), role: str("member"), joinedAt: str("x"), via: str("x") } });
  await gs(page); await page.click("#gsHand"); await page.click("#askYes");
  ok(await until(async () => (await getDoc(at()))?.owner === mid && (await getDoc(at(`/members/${mid}`)))?.role === "owner" && (await getDoc(at(`/members/${uid}`)))?.role === "member"), "hand over: one write the rules accept makes Mo the owner, and Olga takes his role");
  await gs(page); await page.click("#gsLeave"); await page.click("#askYes");
  ok(await until(async () => !(await getDoc(at(`/members/${uid}`))) && (await getDoc(`users/${uid}/meta/groups`))?.list?.length === 0), "leave: her line in the group goes, and the group leaves her list");
  await as("admin", "PATCH", `users/${mid}/meta/groups`, { fields: { list: { arrayValue: { values: [{ mapValue: { fields: { id: str(g), name: str("Study group") } } }] } } } });
  await gs(mo); await mo.click("#gsDelete"); await mo.click("#askYes");
  ok(await until(async () => !(await getDoc(at())) && !Object.keys(await docsAt(at())).length && (await getDoc(`users/${mid}/meta/groups`))?.list?.length === 0), "delete group: its owner deletes its notebooks, their sets, roles and members, then the group, all allowed by the rules");
  await clean(page, "groups (owner)"); await clean(mo, "groups (member)");
  await page.context().close(); await mo.context().close();
});

await part("9. Joining a group by link or invite", async () => {
  const { page, uid } = await newAccount("olga");
  await menu(page, '[data-nb-do="newGroup"]'); await nameIt(page, "Club");
  const g = await groupOf(uid), at = (p = "") => `groups/${g}${p}`;
  // A link that lets people in at once, as Members.
  await gs(page); await page.click("#gsLinkMake");
  const token = await until(async () => (await getDoc(at()))?.link?.token);
  ok(!!token && (await getDoc(`groupLinks/${token}`))?.group === g && (await getDoc(at())).link.role === "member", "join link: made in one write the rules accept, on the group and on a page of its own");
  const joinPage = async (who) => { const p = await openSite(who), id = await signIn(p); await p.goto(`${base}#join/${token}`); await p.reload(); await until(() => vis(p, "#joinGo")); return [p, id]; };
  const [mo, mid] = await joinPage("mo");
  await mo.click("#joinGo");
  ok(await until(async () => (await getDoc(at(`/members/${mid}`)))?.via === token && (await getDoc(`users/${mid}/meta/groups`))?.list?.[0]?.id === g) && await until(async () => /You're in this group/.test(await text(mo, "#joinBody"))),
    "join link: Join puts him in the group with the link's role, as the rules allow");
  // Asking first: Ivy asks, and is let in while her page is open.
  await page.check("#gsLinkAsk");
  ok(await until(async () => (await getDoc(at())).link.approve === true && (await getDoc(`groupLinks/${token}`)).approve === true), "join link: asking first is saved to the link");
  await page.click("#askYes");
  const [ivy, iid] = await joinPage("ivy");
  await ivy.click("#joinGo");
  ok(await until(async () => (await getDoc(at(`/requests/${iid}`)))?.role === "member" && /You asked to join/.test(await text(ivy, "#joinBody"))), "join link: Ask to join sends a request the rules accept");
  await gs(page, '[data-nb-do="groupSettings"]:has-text("asking to join")'); await page.click(`[data-let-in="${iid}"]`);
  ok(await until(async () => (await getDoc(at(`/members/${iid}`)))?.via === "approved" && !(await getDoc(at(`/requests/${iid}`)))) && await until(async () => /You're in “Club” now/.test(await text(ivy, "#banner"))),
    "join requests: Let in puts her in and takes the request away in one write, and her open page says she's in");
  // Invites by email address: Eve's open page finds hers in the notebook menu, and she joins; one left waiting goes with the group.
  const eve = await openSite("eve"), eid = await signIn(eve);
  for (const e of ["Eve@example.com", "late@example.com"]) { await page.fill("#gsMailIn", e); await page.click("#gsMailGo"); await until(async () => !!(await getDoc(`groupMail/${g}_${e.toLowerCase()}`))); }
  await menu(eve, '[data-nb-do="joinInvite"]');
  ok(await until(async () => (await getDoc(at(`/members/${eid}`)))?.via === "mail" && !(await getDoc(`groupMail/${g}_eve@example.com`)) && (await getDoc(`users/${eid}/meta/groups`))?.list?.[0]?.id === g),
    "invites: an invite made in the settings reaches her open page; Join puts her in and takes it away in one write the rules accept");
  // Renamed, a new link, then the group deleted: its link's page follows each time.
  await page.fill("#gsGroupName", "Book club"); await page.click("#gsGroupSave");
  ok(await until(async () => (await getDoc(`groupLinks/${token}`))?.name === "Book club"), "join link: renaming the group renames it on the link's page");
  await page.click("#gsLinkNew");
  const token2 = await until(async () => { const t = (await getDoc(at()))?.link?.token; return t !== token && t; });
  ok(!!token2 && !(await getDoc(`groupLinks/${token}`)) && !!(await getDoc(`groupLinks/${token2}`)), "join link: New link replaces the old one's page");
  await page.click("#gsDelete"); await page.click("#askYes");
  ok(await until(async () => !(await getDoc(at())) && !(await getDoc(`groupLinks/${token2}`)) && !(await getDoc(`groupMail/${g}_late@example.com`))), "delete group: its link's page and invites go with it");
  await clean(page, "join (owner)"); await clean(mo, "join (Mo)"); await clean(ivy, "join (Ivy)"); await clean(eve, "invites (Eve)");
  for (const p of [page, mo, ivy, eve]) await p.context().close();
});

await part("10. Sharing a group's notebook by link", async () => {
  const { page, uid } = await newAccount("olga");
  await menu(page, '[data-nb-do="newGroup"]'); await nameIt(page, "Club");
  const g = await groupOf(uid), at = (p = "") => `groups/${g}${p}`;
  await menu(page, '[data-nb-do="groupNb"]'); await nameIt(page, "Kana");
  await until(async () => (await text(page, "#nbName")) === "Kana");
  await goTable(page);
  await page.fill("#nsCol", "Kana"); await page.fill("#nsUnit", "Week 1"); await page.fill("#nsName", "Vowels"); await page.click('#newSetForm [type="submit"]');
  const n = await until(async () => { const d = await docsAt(at()), id = Object.keys(d).find((p) => /\/notebooks\/[^/]+$/.test(p) && d[p].name === "Kana")?.split("/").at(-1); return id && Object.keys(d).some((p) => p.includes(`/notebooks/${id}/sets/`)) && id; });
  await menu(page, '[data-nb-do="share"]'); await page.click("#askYes");
  const sid = await until(async () => (await getDoc(at(`/notebooks/${n}`)))?.share);
  ok(!!sid && (await getDoc(`shareOwners/${sid}`))?.group === g && await until(async () => Object.keys(await docsAt(`shares/${sid}`)).some((p) => p.includes("/sets/"))) && !(await page.$("#shareListed")),
    "group share: the group shares its notebook, in writes the rules accept, with the copy made and no Browse option");
  await page.click("#askYes");
  // A Member opens it: nothing tries to write the copy.
  const mo = await openSite("mo"), mid = await signIn(mo);
  await as("admin", "PATCH", at(`/members/${mid}`), { fields: { name: str("mo"), role: str("member"), joinedAt: str("x"), via: str("x") } });
  await as("admin", "PATCH", `users/${mid}/meta/groups`, { fields: { list: { arrayValue: { values: [{ mapValue: { fields: { id: str(g), name: str("Club") } } }] } } } });
  await menu(mo, `[data-nb="${g}/${n}"]`); await until(async () => (await text(mo, "#nbName")) === "Kana"); await sleep(2500);
  await clean(mo, "group share (member)");
  await gs(page); await page.click("#gsDelete"); await page.click("#askYes");
  ok(await until(async () => !(await getDoc(at())) && !(await getDoc(`shareOwners/${sid}`)) && !(await getDoc(`shares/${sid}`)) && !Object.keys(await docsAt(`shares/${sid}`)).length), "delete group: its notebook's shared copy goes with it");
  await clean(page, "group share (owner)");
  for (const p of [page, mo]) await p.context().close();
});

await browser.close(); server.close();
console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);

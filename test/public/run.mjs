// Browser tests for the public site (index.html) with Firebase replaced by test/public/fake-firebase.js
// and Anthropic's API mocked. Run: node test/public/run.mjs  (needs Playwright; PLAYWRIGHT_DIR overrides where it lives)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || "/opt/node-tools/node_modules/playwright");
const out = process.env.SHOTS || join(root, "build/test-shots");
mkdirSync(out, { recursive: true });

let failures = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${msg}${extra ? "  " + extra : ""}`); if (!cond) failures++; };

// The real platform code, with the Firebase SDK swapped for the in-memory fake.
const fake = join(root, "test/public/fake-firebase.js");
const entry = ['import "./src/platform/firebase.js";'];
if (process.env.WITH_CHECKER !== "0" && existsSync(join(root, "src/checker.js"))) entry.push('import "./src/checker.js";');
const platformJs = (await esbuild.build({
  stdin: { contents: entry.join("\n"), resolveDir: root, sourcefile: "test-entry.js" },
  bundle: true, format: "iife", write: false, alias: { "firebase/app": fake, "firebase/auth": fake, "firebase/firestore": fake },
})).outputFiles[0].text;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p));
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const KEY = "sk-ant-api03-" + "T3stKey".repeat(8);
const apiCalls = [], allRequests = [];
let apiReply = { status: 200, text: "MAIN: たべる\nFURIGANA: NONE\nREASON: Correct.\nCORRECT: YES" };

async function newPage(ctx, { width = 900, init } = {}) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height: 1000 });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on("request", (r) => allRequests.push({ url: r.url(), body: r.postData() || "", headers: r.headers() }));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (init) await page.addInitScript(init);
  await page.route("**/js/platform.js", (r) => r.fulfill({ contentType: "text/javascript", body: platformJs }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route("https://api.anthropic.com/**", async (r) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    apiCalls.push({ url: r.request().url(), headers: r.request().headers(), body: JSON.parse(r.request().postData() || "{}") });
    const body = apiReply.status === 200
      ? { id: "msg_test", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: apiReply.text }], stop_reason: apiReply.stop || "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }
      : { type: "error", error: { type: apiReply.type || "authentication_error", message: apiReply.message || "invalid x-api-key" } };
    return r.fulfill({ status: apiReply.status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(base);
  await page.waitForTimeout(400);
  return page;
}
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.closest("[hidden]") && getComputedStyle(e).display !== "none"; }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? null, sel);
async function scribble(page, sel = "#mainPad") {
  const b = await (await page.$(sel)).boundingBox();
  await page.mouse.move(b.x + 30, b.y + 30); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 30 + i * 8, b.y + 30 + (i % 2) * 20);
  await page.mouse.up();
}
const fsData = (page) => page.evaluate(() => window.__fs.all());

// ---------- 1. signed out, sign in, empty account ----------
const ctx = await browser.newContext({ acceptDownloads: true });
let page = await newPage(ctx);
ok(await vis(page, "#signInBtn"), "signed out: sign-in button shows");
ok(!(await vis(page, "#setup")), "signed out: practice page hidden");
ok(/site owner can see/.test(await text(page, "#gate")), "signed out: note that the site owner can see stored data");
await page.screenshot({ path: join(out, "1-signin.png") });
await page.evaluate(() => { window.__signInError = "auth/popup-blocked"; });
await page.click("#signInBtn"); await page.waitForTimeout(200);
ok(/blocked the sign-in window/.test(await text(page, "#gate")), "popup blocked: explains it");
await page.evaluate(() => { window.__signInError = null; });
await page.click("#signInBtn"); await page.waitForTimeout(500);
ok(await vis(page, "#setup"), "signed in: practice page shows");
ok((await text(page, "#acctName")) === "student@example.com", "signed in: account name in header");
ok(await vis(page, "#emptyImport"), "empty account: Import button shows");
ok(await vis(page, "#checkPanel"), "checking card shows");
ok(/Built-in/.test(await text(page, '#checkerSeg [aria-pressed="true"]')), "built-in checker is the default");
await page.screenshot({ path: join(out, "2-empty.png"), fullPage: true });

// ---------- 2. import from the empty state ----------
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#emptyImport")]);
await chooser.setFiles(join(root, "test/public/fixtures/sample-export.json"));
await page.waitForTimeout(300);
ok(await vis(page, "#importPreview"), "import: preview shows");
await page.click("#importGo"); await page.waitForTimeout(800);
let data = await fsData(page);
ok(!!data["users/u1/sets/sample-ch1-a"] && !!data["users/u1/kanji/sample-ch1"] && !!data["users/u1/meta/books"], "import: sets, kanji list and book order saved under users/u1/");
ok(Object.keys(data).every((p) => p.startsWith("users/u1/")), "import: nothing written outside the person's folder");
await page.click("#backBtn"); await page.waitForTimeout(200);
ok(await vis(page, '[data-set="sample-ch1-a"]'), "practice page lists the imported sets");

// ---------- 3. 日本語 → English with the built-in checker: self-marking, history saved ----------
await page.click('#histAsk [data-hist="on"]'); await page.waitForTimeout(300);
data = await fsData(page);
ok(data["users/u1/data/settings"]?.history === true, "history on: settings doc at users/u1/data/settings");
await page.click('[data-set="sample-ch1-b"]');
await page.click("#dir-je");
await page.click("#startBtn"); await page.waitForTimeout(300);
let rounds = 0, first = true;
while (await vis(page, "#quiz") && rounds++ < 10) {
  await scribble(page); await page.click("#checkBtn"); await page.waitForTimeout(150);
  if (rounds === 1) { ok(await vis(page, "#selfCheck"), "je + built-in: self-marking panel shows"); await page.screenshot({ path: join(out, "3-selfmark.png") }); }
  if (first) { first = false; await page.click("#selfMiss"); await page.waitForTimeout(150); ok(await vis(page, "#feedback") && !(await vis(page, "#overrideBtn")), "I missed it: answer + scratch pad, no override link"); await page.click("#nextBtn"); }
  else { await page.click("#selfGot"); await page.waitForTimeout(1300); }
  await page.waitForTimeout(150);
}
ok(await vis(page, "#results"), "self-marked practice reaches the results page");
await page.waitForTimeout(500);
data = await fsData(page);
const hist = Object.entries(data).filter(([p]) => /^users\/u1\/data\/t\d/.test(p));
ok(hist.length === 1 && hist[0][1].words.length === 3, "history: one session with 3 words saved under users/u1/data/", String(hist.length));

// ---------- 3b. English → 日本語 with the built-in checker (synthetic handwriting from test/checker/synth.mjs) ----------
if (entry.length > 1) {
  const { writeWord } = await import("../checker/synth.mjs");
  const fixture = JSON.parse(readFileSync(join(root, "test/public/fixtures/sample-export.json"), "utf8"));
  const byEn = new Map(fixture.sets.flatMap((s) => s.words).map((w) => [w.en, w]));
  const write = async (str, seed) => {
    const b = await (await page.$("#mainPad")).boundingBox();
    const { strokes, box } = writeWord(str, seed, { boxW: b.width, boxH: b.height, level: 0.3, mouse: false, swap: 0, reverse: 0, join: 0, lateDakuten: 0 });
    const k = Math.min(1, b.width / box.w, b.height / box.h);
    for (const s of strokes) {
      await page.mouse.move(b.x + s[0][0] * k, b.y + s[0][1] * k); await page.mouse.down();
      for (const [x, y] of s.slice(1)) await page.mouse.move(b.x + x * k, b.y + y * k);
      await page.mouse.up();
    }
  };
  await page.click("#newBtn"); await page.waitForTimeout(200);
  await page.click("#dir-ej"); await page.click("#startBtn"); await page.waitForTimeout(300);
  const seen = [];
  let r = 0;
  while (await vis(page, "#quiz") && r++ < 12) {
    const w = byEn.get(await text(page, "#qText"));
    if (!w) { ok(false, "built-in: prompt is a fixture word", await text(page, "#qText")); break; }
    const kana = w.kana.replace(/（[^）]*）/g, "").split("／")[0];
    const step = seen.length;
    // 1st word: kana; 2nd: another word's kana (must be wrong); 3rd: kanji; after that: kana
    const other = [...byEn.values()].find((x) => x.kana !== w.kana && [...x.kana].length === [...kana].length) || { kana: "ねこ" };
    const answer = step === 1 ? other.kana : step === 2 && w.kanji ? w.kanji : kana;
    await write(answer, 7 + step); await page.click("#checkBtn"); await page.waitForTimeout(600);
    const wrong = await vis(page, "#feedback"), self = await vis(page, "#selfCheck");
    seen.push({ answer, wrong, self, reason: wrong ? await text(page, "#fbReason") : "" });
    if (step === 0) ok(!wrong && !self, "built-in: correct kana is accepted", `${answer}${wrong ? " → " + seen[0].reason : ""}`);
    if (step === 1) {
      ok(wrong && !!seen[1].reason, "built-in: a different word is marked wrong, with a reason", `${answer} for ${kana}: ${seen[1].reason}`);
      ok(/The checker misread/.test(await text(page, "#overrideBtn")), "built-in: override link names the checker");
    }
    if (step === 2) ok(!wrong && !self, "built-in: correct kanji is accepted", `${answer}${wrong ? " → " + seen[2].reason : ""}`);
    if (self) await page.click("#selfGot");
    else if (wrong) await page.click("#nextBtn");
    await page.waitForTimeout(1300);
  }
  ok(await vis(page, "#results"), "built-in practice reaches the results page");
  ok(await page.evaluate(() => window.QCardChecker.verify({ strokes: [[[0, 0], [10, 10]]], candidates: ["龘"], box: { w: 100, h: 100 } }).ok === null),
    "built-in: a character without a template comes back unchecked (self-marked)");
  // section 4 expects set B picked and the direction left at English → 日本語
}

// ---------- 4. own Claude key ----------
await page.click("#newBtn"); await page.waitForTimeout(200);
await page.click('[data-checker="claude"]');
ok(await vis(page, "#keyForm"), "Claude: key form shows");
await page.fill("#keyInput", "not-a-key"); await page.click('#keyForm button[type="submit"]'); await page.waitForTimeout(100);
ok(/doesn't look like an Anthropic API key/.test(await text(page, "#keyMsg")), "rejects text that isn't a key");
await page.fill("#keyInput", KEY); await page.click('#keyForm button[type="submit"]'); await page.waitForTimeout(150);
let st = await page.evaluate(() => ({ s: sessionStorage.getItem("qcard:apiKey"), l: localStorage.getItem("qcard:apiKey"), lk: localStorage.getItem("qcard:apiKeyLocked") }));
ok(st.s === KEY && !st.l && !st.lk, "default: key kept in sessionStorage only");
ok(/this tab only/.test(await text(page, "#keyStatus")), "status says tab only");
await page.screenshot({ path: join(out, "4-key.png"), fullPage: true });
await page.click('[data-set="sample-ch1-b"]'); await page.click('[data-set="sample-ch1-a"]');
await page.click("#dir-ej"); await page.click("#startBtn"); await page.waitForTimeout(300);
await scribble(page); await page.click("#checkBtn"); await page.waitForTimeout(2500);
const call = apiCalls.at(-1);
ok(!!call, "Check sends one request to api.anthropic.com");
if (call) {
  ok(call.headers["x-api-key"] === KEY, "request: x-api-key is the visitor's key");
  ok(call.headers["anthropic-dangerous-direct-browser-access"] === "true", "request: browser access header");
  ok(call.headers["anthropic-beta"] === "server-side-fallback-2026-07-01" && call.body.fallbacks === "default", "request: Opus with server-side fallbacks");
  ok(call.body.model === "claude-opus-5-5" && call.body.output_config?.effort === "medium", "request: model and effort", call.body.model);
  ok(call.body.messages[0].content[0].type === "image" && call.body.messages[0].content.at(-1).type === "text", "request: image then prompt");
}
// An unknown verdict for this word is "wrong" unless the mocked reading matches; either way the flow must finish without errors.
ok(!(await vis(page, "#checkErr")), "no error shown after a good reply");
await page.click("#quitBtn"); await page.waitForTimeout(150);
await page.selectOption("#modelSel", "claude-haiku-5-5");
await page.click("#startBtn"); await page.waitForTimeout(300);
apiReply = { status: 401, type: "authentication_error", message: "invalid x-api-key" };
await scribble(page); await page.click("#checkBtn"); await page.waitForTimeout(2500);
ok(/didn't accept your API key/.test(await text(page, "#checkErr")), "401: explains the key wasn't accepted", await text(page, "#checkErr"));
const hcall = apiCalls.at(-1);
ok(hcall?.body.model === "claude-haiku-5-5" && !("fallbacks" in hcall.body) && !hcall.headers["anthropic-beta"], "Haiku: no fallbacks");
apiReply = { status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." };
await page.click("#checkBtn"); await page.waitForTimeout(2500);
ok(/out of credit/.test(await text(page, "#checkErr")), "low credit: says so");
apiReply = { status: 200, text: "MAIN: x\nFURIGANA: NONE\nREASON: r\nCORRECT: YES" };
await page.click("#quitBtn"); await page.waitForTimeout(150);

// remember with a passcode, then a new tab
await page.click("#forgetKey"); await page.waitForTimeout(100);
st = await page.evaluate(() => [sessionStorage.getItem("qcard:apiKey"), localStorage.getItem("qcard:apiKey"), localStorage.getItem("qcard:apiKeyLocked")]);
ok(st.every((v) => v === null), "Forget my key clears every copy");
await page.fill("#keyInput", KEY); await page.check("#keyRemember");
ok(await vis(page, "#keyPassRow"), "Remember: passcode field appears");
await page.fill("#keyPass", "pass1234"); await page.click('#keyForm button[type="submit"]'); await page.waitForTimeout(2500);
st = await page.evaluate(() => ({ l: localStorage.getItem("qcard:apiKey"), lk: localStorage.getItem("qcard:apiKeyLocked") }));
ok(!st.l && st.lk && !st.lk.includes("T3stKey") && JSON.parse(st.lk).ct, "passcode: only an encrypted copy is stored on the device");
const tab2 = await newPage(ctx);
await tab2.waitForTimeout(300);
ok(/locked/.test(await text(tab2, "#keyStatus")) && await vis(tab2, "#unlockForm"), "new tab: key is locked, unlock form shows");
await tab2.fill("#unlockPass", "wrong"); await tab2.click('#unlockForm button[type="submit"]'); await tab2.waitForTimeout(2500);
ok(/didn't unlock/.test(await text(tab2, "#keyMsg")), "wrong passcode: refused");
await tab2.fill("#unlockPass", "pass1234"); await tab2.click('#unlockForm button[type="submit"]'); await tab2.waitForTimeout(2500);
ok(/unlocked in this tab/.test(await text(tab2, "#keyStatus")), "right passcode: unlocked");
ok((await tab2.evaluate(() => sessionStorage.getItem("qcard:apiKey"))) === KEY, "unlocked key kept for this tab");
await tab2.click("#forgetKey");
await tab2.fill("#keyInput", KEY); await tab2.check("#keyRemember"); await tab2.click('#keyForm button[type="submit"]'); await tab2.waitForTimeout(200);
ok((await tab2.evaluate(() => localStorage.getItem("qcard:apiKey"))) === KEY, "Remember without passcode: plain copy on this device (as the label says)");
await tab2.click("#forgetKey"); await tab2.close();

// ---------- 5. export ----------
await page.click("#toTable"); await page.waitForTimeout(200);
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
ok(/\.json$/.test(dl.suggestedFilename()), "export downloads a .json file", dl.suggestedFilename());
await page.click("#backBtn");

// ---------- 6. the key never leaves for anywhere but Anthropic; no CSP violations ----------
const leaks = allRequests.filter((r) => !r.url.startsWith("https://api.anthropic.com/") && (r.url.includes("T3stKey") || r.body.includes("T3stKey") || Object.values(r.headers).some((v) => String(v).includes("T3stKey"))));
ok(!leaks.length, "the key is only ever sent to api.anthropic.com", leaks.map((r) => r.url).join(" "));
data = await fsData(page);
ok(!JSON.stringify(data).includes("T3stKey"), "the key is never written to the database");
ok(!(await page.evaluate(() => window.__csp)).length, "no Content-Security-Policy violations", (await page.evaluate(() => window.__csp)).join(", "));

// ---------- 7. sign out, another person sees none of it ----------
await page.click("#signOutBtn"); await page.waitForTimeout(800);
ok(await vis(page, "#signInBtn"), "sign out: back to the sign-in screen");
await page.evaluate(() => { window.__nextUser = { uid: "u2", displayName: "Other", email: "other@example.com" }; });
await page.click("#signInBtn"); await page.waitForTimeout(600);
ok(await vis(page, "#emptyImport"), "another account starts empty");
ok(page.errors.length === 0, "no page errors", page.errors.join(" | "));

// ---------- 8. phone width ----------
const phone = await newPage(ctx, { width: 375 });
await phone.waitForTimeout(300);
const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
ok(wide <= 375, "phone: no sideways scrolling", String(wide));
await phone.screenshot({ path: join(out, "8-phone.png"), fullPage: true });

await browser.close(); server.close();
console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);

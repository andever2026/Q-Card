// Browser tests for the public site (index.html) with Firebase replaced by test/public/fake-firebase.js
// and any request to Anthropic's API recorded (there should be none). Run: node test/public/run.mjs  (needs Playwright; PLAYWRIGHT_DIR overrides where it lives)
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
const bundle = async (plugins = []) => (await esbuild.build({
  stdin: { contents: entry.join("\n"), resolveDir: root, sourcefile: "test-entry.js" },
  bundle: true, format: "iife", write: false, alias: { "firebase/app": fake, "firebase/auth": fake, "firebase/firestore": fake }, plugins,
})).outputFiles[0].text;
const platformJs = await bundle();

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p));
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const apiCalls = [], allRequests = [];

async function newPage(ctx, { width = 900, init, initArg } = {}) {
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
  if (init) await page.addInitScript(init, initArg);
  await page.route("**/js/platform.js", (r) => r.fulfill({ contentType: "text/javascript", body: platformJs }));
  // Checking with a visitor's own API key was taken out; nothing should call Anthropic any more.
  await page.route("https://api.anthropic.com/**", (r) => { apiCalls.push(r.request().url()); return r.abort(); });
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
ok(await page.evaluate(() => document.querySelector("#welcome").open) && await vis(page, "#signInBtn") && await vis(page, "#guestBtn"), "new visitor: welcome pop-up with both buttons");
ok((await text(page, "h1")) === "Japanese Vocab Practice" && (await page.title()) === "Japanese Vocab Practice", "name: Japanese Vocab Practice");
ok(/combining traditional Q-Cards with handwriting recognition/.test(await text(page, "#welcome .lead")), "welcome: intro line");
ok((await page.evaluate(() => document.fonts.load("600 20px 'Klee One'", "あ"))).length > 0, "fonts: Klee One loads from the site");
await page.screenshot({ path: join(out, "1-signin.png") });
await page.evaluate(() => { window.__signInError = "auth/popup-blocked"; });
await page.click("#signInBtn"); await page.waitForTimeout(200);
ok(/blocked the sign-in window/.test(await text(page, "#welcomeErr")), "popup blocked: explains it");
await page.evaluate(() => { window.__signInError = null; });
await page.click("#signInBtn"); await page.waitForTimeout(500);
ok(await vis(page, "#setup") && !(await vis(page, "#welcome")), "signed in: practice page shows, pop-up gone");
ok(!(await page.$("#acct")) && !(await page.$("#palPick:not(#settings *)")), "header: no account line or colour dots, just the settings gear");
await page.click("#settingsBtn");
const setOpen = (p) => p.evaluate(() => document.querySelector("#settings").open);
ok(await setOpen(page) && /student@example\.com/.test(await text(page, "#acctName")) && (await text(page, "#signOutBtn")) === "Sign out" && (await text(page, "#delStart")) === "Delete my account", "settings: shows the signed-in account, Sign out and Delete my account", await text(page, "#acctName"));
await page.click("#settingsClose");
ok(!(await setOpen(page)), "settings: ✕ closes it");
ok(await vis(page, '[data-set="samples-greetings"]') && await vis(page, "#sampleNote"), "new account: starts with the sample sets");
ok((await page.$eval("#uptoSel", (s) => s.value)) === "auto", "samples: 'Kanji learned up to' starts at Highest picked unit", await page.$eval("#uptoSel", (s) => s.value));
const sampleDocs = (d) => Object.keys(d).filter((p) => /^users\/u1\/(sets|kanji)\/samples-/.test(p));
let data = await fsData(page);
ok(!!data["users/u1/meta/samples"] && sampleDocs(data).length === 9, "samples: 6 sets and 3 kanji lists saved, offer remembered", sampleDocs(data).join(", "));
const tagChips = () => page.$$eval("#pickTags [data-tag]", (bs) => bs.map((b) => b.textContent));
ok(await vis(page, "#pickTagRow") && (await tagChips()).join("|") === "Katakana5|Phrases5|Verbs5|Nouns2" && /Filter/.test(await text(page, "#pickTagRow")) && !(await page.$("#pickTags [aria-pressed=\"true\"]")), "tags: Filter counts the sets each tag hides, most hidden first, none picked", (await tagChips()).join("|"));
ok((await page.$eval('#pickTags [data-tag="nouns"]', (b) => b.title)) === "Hides 2 of 6 sets", "tags: the count is explained on hover");
await page.click('#pickTags [data-tag="verbs"]');
const shownSets = () => page.$$eval("#setPicker [data-set]", (bs) => bs.map((b) => b.dataset.set).join(","));
ok((await shownSets()) === "samples-verbs", "tags: picking Verbs shows only the verb set", await shownSets());
await page.locator("#setup .panel").first().screenshot({ path: join(out, "2-filter.png") });
await page.click('#pickTags [data-tag="phrases"]');
ok((await shownSets()) === "samples-greetings,samples-verbs", "tags: picking a second tag adds its sets", await shownSets());
await page.click("#tagClear");
ok((await shownSets()).split(",").length === 6 && await page.evaluate(() => localStorage.getItem("jpq:pickTags")) === "[]", "tags: Clear filter shows every set again");
await page.click('[data-set="samples-verbs"]'); await page.click("#dir-ej"); await page.click("#mode-verb"); await page.click("#startBtn"); await page.waitForTimeout(300);
ok(/^0 of 60 done/.test(await text(page, "#progLbl")), "samples: all 12 sample verbs get their five forms", await text(page, "#progLbl"));
await page.click("#quitBtn"); await page.waitForTimeout(150);
await page.click("#mode-default");
await page.screenshot({ path: join(out, "2-samples.png"), fullPage: true });
await page.click("#sampleRemove"); await page.click("#sampleYes"); await page.waitForTimeout(500);
data = await fsData(page);
ok(!sampleDocs(data).length && !!data["users/u1/meta/samples"] && await vis(page, "#emptyImport") && !(await vis(page, "#sampleNote")), "samples: removed, empty account shows Import");
ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem("jpq:selected") || "[]"))).some((id) => id.startsWith("samples-")), "samples: picks on removed sample sets are dropped", await page.evaluate(() => localStorage.getItem("jpq:selected")));
await page.screenshot({ path: join(out, "2-empty.png"), fullPage: true });

// ---------- 2. import from the empty state ----------
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#emptyImport")]);
await chooser.setFiles(join(root, "test/public/fixtures/sample-export.json"));
await page.waitForTimeout(300);
ok(await setOpen(page) && await vis(page, "#importPreview"), "import: the empty state's Import opens Settings with the preview");
await page.click("#importGo"); await page.waitForTimeout(800);
data = await fsData(page);
ok(!!data["users/u1/sets/sample-ch1-a"] && !!data["users/u1/kanji/sample-ch1"] && !!data["users/u1/meta/books"], "import: sets, kanji list and book order saved under users/u1/");
ok(Object.keys(data).every((p) => p.startsWith("users/u1/")), "import: nothing written outside the person's folder");
{ const d = data["users/u1/sets/sample-ch1-a"], k = data["users/u1/kanji/sample-ch1"];
  ok(d?.collection === "Sample" && d?.unit === "Ch. 1" && d?.name === "A · Food and drink" && !("book" in d) && !("chapter" in d) && k?.unit === "Ch. 1",
    "import: an older file (book, chapter, section) is saved as collection, unit and set name", JSON.stringify({ ...d, words: undefined })); }
await page.click("#settingsClose"); await page.waitForTimeout(200);
ok(await vis(page, '[data-set="sample-ch1-a"]'), "practice page lists the imported sets");

// ---------- 3. 日本語 → English with the built-in checker: self-marking, history saved ----------
ok(/from the server/.test(await text(page, "#histAsk")), "history question (account): says it can be deleted from the server");
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

  // 日本語 → English: the meaning as worded is accepted; other English is self-marked (synthetic print from test/checker/synth-en.mjs)
  const { writeEnglish, defaultFont } = await import("../checker/synth-en.mjs");
  const font = defaultFont();
  const byJp = new Map(fixture.sets.flatMap((s) => s.words).flatMap((w) => [[w.kanji, w], [w.kana, w]]).filter(([k]) => k));
  const writeEn = async (str, seed) => {
    const b = await (await page.$("#mainPad")).boundingBox();
    const { strokes, box } = writeEnglish(str, font, seed, { level: 0.3, late: 0, swap: 0, reverse: 0, mouse: false, capPx: 40 });
    const k = Math.min(1, b.width / box.w, b.height / box.h);
    for (const s of strokes) {
      await page.mouse.move(b.x + s[0][0] * k, b.y + s[0][1] * k); await page.mouse.down();
      for (const [x, y] of s.slice(1)) await page.mouse.move(b.x + x * k, b.y + y * k);
      await page.mouse.up();
    }
  };
  await page.click("#newBtn"); await page.waitForTimeout(200);
  await page.click("#dir-je"); await page.click("#startBtn"); await page.waitForTimeout(300);
  r = 0;
  while (await vis(page, "#quiz") && r < 12) {
    const w = byJp.get(await text(page, "#qText"));
    if (!w) { ok(false, "English: prompt is a fixture word", await text(page, "#qText")); break; }
    // 1st word: its meaning; 2nd: another meaning (self-marked); 3rd: its meaning, capitalised
    const other = ["water", "coffee", "school"].find((x) => x !== w.en);
    const answer = r === 1 ? other : r === 2 ? w.en[0].toUpperCase() + w.en.slice(1) : w.en;
    await writeEn(answer, 21 + r); await page.click("#checkBtn"); await page.waitForTimeout(600);
    const wrong = await vis(page, "#feedback"), self = await vis(page, "#selfCheck");
    if (r === 0) ok(!wrong && !self, "English: the meaning as worded is accepted", answer);
    if (r === 1) ok(self && !wrong && /couldn't match/.test(await text(page, "#selfHead")), "English: another meaning goes to self-marking, saying it didn't match", `${answer} for ${w.en}`);
    if (r === 2) ok(!wrong && !self, "English: a capital first letter is accepted", answer);
    if (self) await page.click("#selfGot");
    else if (wrong) await page.click("#nextBtn");
    await page.waitForTimeout(1300);
    r++;
  }
  ok(r === 3 && await vis(page, "#results"), "English practice reaches the results page");
}

// ---------- 4. no "How answers are checked" card ----------
await page.click("#newBtn"); await page.waitForTimeout(200);
ok(!(await page.$("#checkPanel")) && !(await page.$("#keyForm")) && !/How answers are checked/.test(await page.content()), "no 'How answers are checked' card");

// ---------- 5. tags, export ----------
await page.click("#toTable"); await page.waitForTimeout(200);
const tset = '[data-sid="sample-ch1-a"]';
await page.click(`${tset} [data-toggle]`); await page.click(`${tset} [data-editset]`);
await page.fill(`${tset} [data-ef="tags"]`, " Quiz 1,quiz 1 、 Food  and drink, ");
await page.click(`${tset} [data-editform] [type="submit"]`); await page.waitForTimeout(400);
data = await fsData(page);
ok(JSON.stringify(data["users/u1/sets/sample-ch1-a"]?.tags) === '["Quiz 1","Food and drink"]', "tags: saved from Edit details, tidied and without repeats", JSON.stringify(data["users/u1/sets/sample-ch1-a"]?.tags));
ok((await page.$$eval(`${tset} .tag`, (xs) => xs.map((x) => x.textContent).join("|"))) === "Quiz 1|Food and drink", "tags: shown on the set in the vocab table");
await page.click(`${tset} [data-editset]`); await page.locator(tset).screenshot({ path: join(out, "5-tags-table.png") }); await page.click(`${tset} [data-editcancel]`);
ok(!(await page.$("#table #exportBtn")), "export / import: no longer in the vocab table");
await page.click("#settingsBtn");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
await page.click("#settingsClose");
ok(/\.json$/.test(dl.suggestedFilename()), "export downloads a .json file", dl.suggestedFilename());
const exported = JSON.parse(readFileSync(await dl.path(), "utf8"));
ok(JSON.stringify(exported.sets.find((x) => x.id === "sample-ch1-a")?.tags) === '["Quiz 1","Food and drink"]', "export keeps the tags");
{ const x = exported.sets.find((x) => x.id === "sample-ch1-a");
  ok(exported.version === 2 && x?.collection === "Sample" && x?.unit === "Ch. 1" && x?.name === "A · Food and drink" && !("book" in x) && !("updatedAt" in x) && Array.isArray(exported.collections?.order),
    "export: written as collection, unit and set name, with the collection order", JSON.stringify({ ...x, words: undefined })); }
await page.click("#backBtn"); await page.waitForTimeout(200);
await page.click('#pickTags [data-tag="quiz 1"]');
ok((await page.$$eval("#setPicker [data-set]", (bs) => bs.map((b) => b.dataset.set).join(","))) === "sample-ch1-a", "tags: a new tag shows up in Filter and filters");
await page.click("#tagClear");

// ---------- 6. choices follow the account to another device ----------
// Another device = the same account with none of this browser's choices (jpq:…) saved.
const pressed = (sel) => page.$eval(sel, (b) => b.getAttribute("aria-pressed") === "true");
await page.click("#dir-je"); await page.click("#mode-kana");
if (!(await pressed('[data-set="sample-ch1-a"]'))) await page.click('[data-set="sample-ch1-a"]');
await page.click('#pickTags [data-tag="quiz 1"]');
await page.click("#settingsBtn"); await page.click('#themePick [data-theme-pick="dark"]'); await page.click('#palPick [data-pal="claude"]'); await page.click("#settingsClose");
await page.waitForTimeout(1300);
data = await fsData(page);
const prefs = data["users/u1/data/prefs"] || {};
ok(prefs.dir === "je" && prefs.mode === "kana" && prefs.theme === "dark" && prefs.palette === "claude" && prefs.selected?.includes("sample-ch1-a") && prefs.pickTags?.includes("quiz 1"), "choices: saved to the account", JSON.stringify(prefs).slice(0, 200));
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("jpq:")) localStorage.removeItem(k); });
await page.reload(); await page.waitForTimeout(1200);
ok(await pressed("#dir-je") && await pressed("#mode-kana") && await pressed('[data-set="sample-ch1-a"]') && await pressed('#pickTags [data-tag="quiz 1"]'), "choices: direction, mode, picked set and filter come back on another device");
ok(await page.evaluate(() => document.documentElement.dataset.theme === "dark" && document.documentElement.dataset.palette === "claude"), "choices: light or dark and colours come back too");
await page.click("#tagClear"); await page.click("#dir-ej"); await page.click("#mode-default");
await page.click("#settingsBtn"); await page.click('#themePick [data-theme-pick=""]'); await page.click('#palPick [data-pal="indigo"]'); await page.click("#settingsClose");
await page.waitForTimeout(1300);
ok((await fsData(page))["users/u1/data/prefs"]?.dir === "ej", "choices: later changes are saved again");
ok(!apiCalls.length, "nothing is ever sent to Anthropic", apiCalls.join(" "));
ok(!(await page.evaluate(() => window.__csp)).length, "no Content-Security-Policy violations", (await page.evaluate(() => window.__csp)).join(", "));

// ---------- 7. sign out, another person sees none of it ----------
await page.click("#settingsBtn"); await page.click("#signOutBtn"); await page.waitForTimeout(800);
ok(!(await page.evaluate(() => document.querySelector("#welcome").open)) && await vis(page, "#setup"), "sign out from Settings: no welcome pop-up after the first visit");
await page.evaluate(() => { window.__nextUser = { uid: "u2", displayName: "Other", email: "other@example.com" }; });
await page.click("#settingsBtn"); await page.click("#signOutBtn"); await page.waitForTimeout(600);
ok(await vis(page, '[data-set="samples-greetings"]') && !(await vis(page, '[data-set="sample-ch1-a"]')), "another account starts with only the sample sets");
ok(page.errors.length === 0, "no page errors", page.errors.join(" | "));
ok(!allRequests.some((r) => /fonts\.(googleapis|gstatic)\.com/.test(r.url)), "fonts: nothing requested from Google Fonts");

// ---------- 8. phone width ----------
const phone = await newPage(ctx, { width: 375 });
await phone.waitForTimeout(300);
const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
ok(wide <= 375, "phone: no sideways scrolling", String(wide));
await phone.screenshot({ path: join(out, "8-phone.png"), fullPage: true });
await phone.click("#settingsBtn");
const sw = await phone.$eval("#settings", (d) => d.getBoundingClientRect().width);
ok(sw <= 375 - 24 && (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 375, "phone: the settings pop-up fits", String(sw));
await phone.screenshot({ path: join(out, "8-settings-phone.png") });
await phone.close();

// ---------- 8b. delete an account: its data, then the Google account ----------
await page.click('#histAsk [data-hist="on"]'); await page.waitForTimeout(300);
ok(!!(await fsData(page))["users/u2/data/settings"], "delete: (history setting saved, so there's something under data/)");
await page.click('[data-set="samples-greetings"]'); await page.click("#startBtn"); await page.waitForTimeout(300); await scribble(page); await page.click("#quitBtn"); await page.waitForTimeout(200);
ok(await vis(page, "#resumeBtn"), "delete: (a practice left midway, with writing, to resume)");
await page.click("#settingsBtn"); await page.click("#delStart");
ok(/deletes your account/.test(await text(page, "#delAcct")) && await vis(page, "#delYes"), "delete: asks before deleting");
await page.screenshot({ path: join(out, "8-delete.png") });
await page.click("#delNo");
ok(await vis(page, "#delStart") && !(await page.$("#delYes")), "delete: Cancel backs out");
await page.evaluate(() => { window.__staleLogin = true; });
await page.click("#delStart"); await page.click("#delYes"); await page.waitForTimeout(1500);
data = await fsData(page);
ok(!Object.keys(data).some((p) => p.startsWith("users/u2/")) && Object.keys(data).some((p) => p.startsWith("users/u1/")), "delete: everything of that account is gone, other accounts untouched", Object.keys(data).filter((p) => p.startsWith("users/u2/")).join(", "));
ok((await page.evaluate(() => JSON.parse(localStorage.getItem("fake:deleted") || "[]"))).includes("u2"), "delete: the Google account is deleted too (signing in again first when Google asks)");
ok(await page.evaluate(() => document.querySelector("#welcome").open), "delete: the page starts over at the welcome pop-up");
ok(!(await vis(page, "#resumeBtn")) && await page.evaluate(() => localStorage.getItem("jpq:resume") === null && localStorage.getItem("jpq:selected") === null),
  "delete: the account's choices and its practice to resume (words and writing) are gone from this browser too", await page.evaluate(() => localStorage.getItem("jpq:resume")));

// ---------- 9. use without signing in: everything in this browser ----------
const lctx = await browser.newContext({ acceptDownloads: true });
let lp = await newPage(lctx, { width: 375 });
ok(await vis(lp, "#guestBtn"), "welcome: 'Continue as a guest' shows");
ok(await vis(lp, "#welcomeClose"), "welcome: an X to close it");
ok(/guest to keep it in this browser only/.test(await text(lp, "#welcome")), "welcome: explains where a guest's data is kept");
ok((await lp.evaluate(() => document.documentElement.scrollWidth)) <= 375, "welcome pop-up fits a phone");
await lp.screenshot({ path: join(out, "9-signin-phone.png") });
await lp.setViewportSize({ width: 900, height: 1000 });
await lp.click("#welcomeClose"); await lp.waitForTimeout(400); // the X works like Continue as a guest
ok(await vis(lp, "#setup") && !(await lp.evaluate(() => document.querySelector("#welcome").open)) && !(await lp.evaluate(() => document.body.textContent.includes("Guest: saved"))), "guest: the X closes the pop-up as a guest, no guest line in the header");
ok(await lp.evaluate(() => localStorage.getItem("qcard:mode")) === "local", "guest: closing with the X is remembered like Continue as a guest");
await lp.click("#settingsBtn");
ok(/Not signed in/.test(await text(lp, "#acctName")) && (await text(lp, "#signOutBtn")) === "Sign in with Google" && (await text(lp, "#delStart")) === "Delete local storage", "settings (guest): not signed in, offers Sign in and Delete local storage");
ok(!(await vis(lp, "#delTip")) && (await lp.hover("#delAcct .qtip"), await vis(lp, "#delTip")) && /treats you as a new user/.test(await text(lp, "#delTip")), "settings (guest): the ? beside Delete local storage explains it on hover");
await lp.screenshot({ path: join(out, "9-settings-delete-tip.png") });
ok((await text(lp, "#setStats")) === "6 sets · 55 words · 3 kanji lists", "settings: counts the sets, words and kanji lists", await text(lp, "#setStats"));
await lp.click('#themePick [data-theme-pick="dark"]'); await lp.click('#palPick [data-pal="claude"]');
ok(await lp.evaluate(() => document.documentElement.dataset.theme === "dark" && document.documentElement.dataset.palette === "claude" && localStorage.getItem("jpq:theme") === '"dark"'), "settings: Dark and Warm apply and are remembered");
await lp.screenshot({ path: join(out, "9-settings-dark.png") });
await lp.click('#themePick [data-theme-pick="light"]'); await lp.click('#palPick [data-pal="indigo"]');
await lp.screenshot({ path: join(out, "9-settings.png") });
await lp.mouse.click(8, 8);
ok(!(await setOpen(lp)), "settings: clicking outside closes it");
ok(await vis(lp, '[data-set="samples-greetings"]'), "guest: starts with the sample sets");
await lp.click("#sampleRemove"); await lp.click("#sampleNo");
ok(await vis(lp, '[data-set="samples-greetings"]'), "samples: 'Keep them' keeps them");
await lp.click("#sampleRemove"); await lp.click("#sampleYes"); await lp.waitForTimeout(400);
ok(await vis(lp, "#emptySamples") && !(await lp.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("qcard:local:sets/samples-")))), "guest: samples removed from this browser, empty state offers them again");
await lp.click("#emptySamples"); await lp.waitForTimeout(600);
ok(await vis(lp, '[data-set="samples-katakana"]'), "samples: added back from the empty state");
await lp.click("#sampleRemove"); await lp.click("#sampleYes"); await lp.waitForTimeout(400);
const [lchooser] = await Promise.all([lp.waitForEvent("filechooser"), lp.click("#emptyImport")]);
await lchooser.setFiles(join(root, "test/public/fixtures/sample-export.json"));
await lp.waitForTimeout(300); await lp.click("#importGo"); await lp.waitForTimeout(800); await lp.click("#settingsClose");
let ls = await lp.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("qcard:local:")));
ok(ls.includes("qcard:local:sets/sample-ch1-a") && ls.includes("qcard:local:meta/books"), "local: imported sets saved in localStorage", ls.join(", "));
ok(Object.keys(await fsData(lp)).length === 0, "local: nothing written to the database");
ok(/saved only in this browser/.test(await text(lp, "#histAsk")) && !/from the server/.test(await text(lp, "#histAsk")), "local: the history question says it stays in this browser");
await lp.click('#histAsk [data-hist="on"]'); await lp.waitForTimeout(200);
await lp.click('[data-set="sample-ch1-b"]'); await lp.click("#dir-je"); await lp.click("#startBtn"); await lp.waitForTimeout(300);
for (let i = 0; i < 10 && await vis(lp, "#quiz"); i++) { await scribble(lp); await lp.click("#checkBtn"); await lp.waitForTimeout(150); await lp.click("#selfGot"); await lp.waitForTimeout(1400); }
ls = await lp.evaluate(() => Object.keys(localStorage).filter((k) => /^qcard:local:data\/users\/local\/t\d/.test(k)));
ok(ls.length === 1, "local: practice history saved in localStorage", String(ls.length));
await lp.close();
lp = await newPage(lctx);
await lp.waitForTimeout(300);
ok(await vis(lp, "#setup") && await vis(lp, '[data-set="sample-ch1-a"]') && !(await vis(lp, "#welcome")), "guest: coming back goes straight to the saved sets, no pop-up");
ok(!(await vis(lp, '[data-set="samples-greetings"]')), "samples: removed ones don't come back");
ok(await lp.evaluate(() => document.documentElement.dataset.theme === "light"), "settings: Light is still on after coming back");
await lp.click("#settingsBtn"); await lp.click('#themePick [data-theme-pick=""]');
ok(await lp.evaluate(() => !("theme" in document.documentElement.dataset)), "settings: Match device follows the device again");
await lp.evaluate(() => { window.__signInError = "auth/popup-blocked"; });
await lp.click("#signOutBtn"); await lp.waitForTimeout(200);
ok(await setOpen(lp) && !(await lp.evaluate(() => document.querySelector("#welcome").open)) && /blocked the sign-in window/.test(await text(lp, "#acctErr")), "guest: Sign in with Google in Settings goes straight to Google (a blocked pop-up is explained there)");
await lp.evaluate(() => { window.__signInError = null; });
await lp.click("#signOutBtn"); await lp.waitForTimeout(1000);
await lp.click("#settingsBtn");
ok(/student@example\.com/.test(await text(lp, "#acctName")) && await vis(lp, '[data-set="samples-greetings"]') && !(await vis(lp, '[data-set="sample-ch1-a"]')), "Sign in from local: switches to the new account, which starts with the samples");
ok(await lp.evaluate(() => localStorage.getItem("qcard:mode")) === null, "signed in: no longer remembered as local");
await lp.click("#signOutBtn"); await lp.waitForTimeout(1000);
ok(!(await lp.evaluate(() => document.querySelector("#welcome").open)) && await vis(lp, "#setup"), "signed out: straight back to this browser's data, no pop-up");
ok(await vis(lp, '[data-set="sample-ch1-a"]'), "local data is still there after using an account");
await lp.click("#settingsBtn"); await lp.click('#palPick [data-pal="claude"]'); await lp.click("#delStart");
ok(/saved in this browser/.test(await text(lp, "#delAcct")), "delete (guest): asks before deleting this browser's data");
await lp.click("#delYes"); await lp.waitForTimeout(1200);
ok(await lp.evaluate(() => !("palette" in document.documentElement.dataset) && localStorage.getItem("jpq:palette") !== '"claude"'), "delete (guest): this browser's choices go too (back to Blue)");
ls = await lp.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("qcard:local:sets/sample-") || k.startsWith("qcard:local:data/") || k === "qcard:mode"));
ok(!ls.length && await lp.evaluate(() => document.querySelector("#welcome").open), "delete (guest): this browser's sets and history are gone and the page starts over", ls.join(", "));
ok(lp.errors.length === 0, "local: no page errors", lp.errors.join(" | "));
ok((await lp.evaluate(() => window.__csp)).length === 0, "local: no CSP violations");

// ---------- 10. kinds of sets as tags; the old Show choice carries over ----------
const kctx = await browser.newContext();
const kp = await newPage(kctx, { init: () => {
  if (localStorage.getItem("qcard:mode")) return;
  const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v)), w = [{ id: "w1", en: "water", kana: "みず", kanji: "水" }];
  localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
  put("sets/k-a", { book: "B", chapter: 1, section: "A", label: "", words: w }); put("sets/k-b", { book: "B", chapter: 1, section: "B", label: "", tags: ["Verbs"], words: w });
  put("sets/k-x", { book: "B", chapter: 1, section: "Extras", label: "", words: w }); put("sets/k-s", { book: "B", chapter: 1, section: "Supp. 1", label: "", words: w });
  localStorage.setItem("jpq:pickKinds", JSON.stringify(["main", "supp"]));
} });
await kp.waitForTimeout(500);
ok((await kp.$$eval("#pickTags [data-tag]", (bs) => bs.map((b) => b.textContent))).join("|") === "Extras3|Supp.3|Verbs3|Main sets2", "kinds: Main sets, Extras and Supp. are tags when there's more than one kind", (await kp.$$eval("#pickTags [data-tag]", (bs) => bs.map((b) => b.textContent))).join("|"));
ok((await kp.$$eval("#setPicker [data-set]", (bs) => bs.map((b) => b.dataset.set).join(","))) === "k-a,k-b,k-s" && (await kp.$$eval('#pickTags [aria-pressed="true"]', (bs) => bs.map((b) => b.dataset.tag).sort().join(","))) === "main sets,supp.", "kinds: the old Show choice (Extras switched off) carries over as picked tags", (await kp.$$eval("#setPicker [data-set]", (bs) => bs.map((b) => b.dataset.set).join(","))) + " / " + (await kp.$$eval('#pickTags [aria-pressed="true"]', (bs) => bs.map((b) => b.dataset.tag).join(","))));
ok(kp.errors.length === 0, "kinds: no page errors", kp.errors.join(" | "));

// ---------- 11. Collection › Unit › Set: older documents and picks, courses, adding and editing ----------
const uctx = await browser.newContext();
const up = await newPage(uctx, { init: () => {
  if (localStorage.getItem("qcard:mode")) return;
  const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v)), w = [{ id: "w1", en: "water", kana: "みず", kanji: "水" }];
  localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
  // Saved before units: book, numbered chapter, section and label.
  put("sets/n-1a", { book: "Nakama", chapter: 1, section: "A", label: "Hello", words: w }); put("sets/n-2a", { book: "Nakama", chapter: 2, section: "A", label: "Food", words: w });
  put("sets/n-2x", { book: "Nakama", chapter: 2, section: "Extras", label: "", words: w }); put("sets/n-10a", { book: "Nakama", chapter: 10, section: "A", label: "", words: w });
  put("kanji/n-2", { book: "Nakama", chapter: 2, kanji: "水" });
  put("meta/courses", { courses: [{ name: "J1", parts: [{ book: "Nakama", from: 1, to: 2 }] }] });
  // Saved with units.
  put("sets/m-w1", { collection: "Mine", unit: "Week 1", name: "Colours", words: w }); put("sets/m-w10", { collection: "Mine", unit: "Week 10", name: "Animals", words: w });
  put("sets/m-w2", { collection: "Mine", unit: "Week 2", name: "Shops", words: w });
  localStorage.setItem("jpq:bookShow", JSON.stringify({ Nakama: "some" })); localStorage.setItem("jpq:pickChs", JSON.stringify(["Nakama\u00012"]));
  localStorage.setItem("jpq:uptoPick", JSON.stringify("Nakama\u00012"));
} });
await up.waitForTimeout(500);
const rowsOf = (sel) => up.$$eval(`${sel} .pchrow`, (rs) => rs.map((r) => `${r.querySelector(".chbook")?.textContent ?? ""}: ${[...r.querySelectorAll(".chip")].map((c) => c.textContent + (c.getAttribute("aria-pressed") === "true" ? "*" : "")).join(", ")}`).join(" | "));
let rows = await rowsOf("#pickChs");
ok(rows === "Mine: All*, Week 1, Week 2, Week 10 | Nakama: All, Ch. 1, Ch. 2*, Ch. 10", "units: older chapters read as Ch. N, units sort with numbers in order, an older chapter pick carries over", rows);
const chipNames = () => up.$$eval("#setPicker [data-set]", (bs) => bs.map((b) => b.childNodes[0].textContent).join(", "));
ok((await chipNames()) === "Colours, Shops, Animals, A · Food, Extras", "units: older sections and labels read as set names (Extras last)", await chipNames());
ok((await up.$eval("#uptoSel", (s) => s.value)) === "Nakama\u0001Ch. 2" && /Nakama › Ch\. 2/.test(await up.$eval("#uptoSel", (s) => s.selectedOptions[0].textContent)),
  "units: an older 'Kanji learned up to' pick carries over", await up.$eval("#uptoSel", (s) => s.value));
await up.click('#groupSeg [data-group="course"]'); await up.waitForTimeout(200);
rows = await rowsOf("#pickChs");
ok(rows === "J1: All, Ch. 1, Ch. 2* | Other: All, Week 1*, Week 2*, Week 10*, Ch. 10", "units: an older course (chapters 1 to 2) covers units Ch. 1 and Ch. 2", rows);
await up.click('#groupSeg [data-group="book"]');
await up.click("#toTable"); await up.waitForTimeout(200);
await up.fill("#nsCol", "mine"); await up.fill("#nsUnit", "week 2"); await up.fill("#nsName", "Weather");
await up.click('#newSetForm [type="submit"]'); await up.waitForTimeout(400);
const local = () => up.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("qcard:local:sets/")).map((k) => [k.slice(17), JSON.parse(localStorage.getItem(k))])));
let docs = await local(), added = Object.entries(docs).find(([, d]) => d.name === "Weather");
ok(added && added[1].collection === "Mine" && added[1].unit === "Week 2" && !("book" in added[1]), "units: a new set is saved with collection, unit and name, matching an existing unit whatever its case", JSON.stringify(added?.[1] ? { id: added[0], ...added[1], words: undefined } : null));
const ot = '[data-sid="n-1a"]';
await up.click('#tChs .pchrow:nth-child(2) [data-k="all"]'); await up.waitForTimeout(100);
await up.click(`${ot} [data-toggle]`); await up.click(`${ot} [data-editset]`);
ok((await up.$eval(`${ot} [data-ef="unit"]`, (i) => i.value)) === "Ch. 1" && (await up.$eval(`${ot} [data-ef="name"]`, (i) => i.value)) === "A · Hello", "units: Edit details shows an older set as unit and name");
await up.fill(`${ot} [data-ef="name"]`, "A · Greetings"); await up.click(`${ot} [data-editform] [type="submit"]`); await up.waitForTimeout(400);
docs = await local();
ok(docs["n-1a"]?.name === "A · Greetings" && docs["n-1a"]?.unit === "Ch. 1" && docs["n-1a"]?.collection === "Nakama", "units: editing an older set saves it with collection, unit and name", JSON.stringify({ ...docs["n-1a"], words: undefined }));
await up.screenshot({ path: join(out, "11-units-table.png"), fullPage: true });
await up.click("#backBtn"); await up.waitForTimeout(200);
await up.screenshot({ path: join(out, "11-units.png"), fullPage: true });
ok(up.errors.length === 0, "units: no page errors", up.errors.join(" | "));

// ---------- 12. resume a practice left midway; the title and gear step aside while writing ----------
const rctx = await browser.newContext();
let rp = await newPage(rctx, { init: () => {
  if (localStorage.getItem("qcard:mode")) return;
  const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
  localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
  put("sets/r-a", { collection: "R", unit: "Week 1", name: "Three", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }, { id: "b", en: "tea", kana: "おちゃ", kanji: "お茶" }, { id: "c", en: "rice", kana: "ごはん", kanji: "" }] });
} });
const answer = async (got) => { await scribble(rp); await rp.click("#checkBtn"); await rp.waitForTimeout(150); if (got) { await rp.click("#selfGot"); await rp.waitForTimeout(1300); } else { await rp.click("#selfMiss"); await rp.waitForTimeout(150); } };
ok(!(await vis(rp, "#resumeBtn")), "resume: no Resume button before any practice");
await rp.click('[data-set="r-a"]'); await rp.click("#dir-je"); await rp.click("#startBtn"); await rp.waitForTimeout(300);
ok(!(await vis(rp, "header h1")) && !(await vis(rp, "#settingsBtn")), "practice: the title and settings gear are hidden while writing");
await rp.screenshot({ path: join(out, "12-practice-no-header.png") });
await answer(true); await answer(false); await rp.click("#nextBtn"); await rp.waitForTimeout(200);
// the next word is written on but not checked when quitting
await scribble(rp); await scribble(rp);
await rp.click("#quitBtn"); await rp.waitForTimeout(200);
ok((await rp.evaluate(() => JSON.parse(localStorage.getItem("jpq:resume"))?.ink?.main?.s?.length)) === 2, "resume: what was written on the open question is saved with it");
ok(await vis(rp, "header h1") && await vis(rp, "#settingsBtn"), "practice: the title and gear come back after quitting");
ok(await vis(rp, "#resumeBtn") && /Resume last practice\s*2 left/.test(await text(rp, "#resumeBtn")), "resume: after quitting midway, Resume last practice shows with what's left", await text(rp, "#resumeBtn"));
await rp.locator(".startrow").first().screenshot({ path: join(out, "12-resume.png") });
await rp.reload(); await rp.waitForTimeout(600);
ok(await vis(rp, "#resumeBtn"), "resume: still there after reloading the page");
await rp.click("#dir-ej"); await rp.click("#mode-kana");
await rp.click("#resumeBtn"); await rp.waitForTimeout(300);
ok(await vis(rp, "#quiz") && /^1 of 3 done/.test(await text(rp, "#progLbl")) && /jp/.test(await rp.$eval("#qText", (e) => e.className)), "resume: picks up where it was left, in its own direction", await text(rp, "#progLbl"));
ok(!(await rp.$eval("#checkBtn", (b) => b.disabled)) && await rp.evaluate(() => { const c = document.querySelector("#mainPad"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }),
  "resume: the writing comes back in the answer box");
await rp.screenshot({ path: join(out, "12-resume-ink.png") });
let rr = 0;
while (await vis(rp, "#quiz") && rr++ < 6) await answer(true);
ok(await vis(rp, "#results") && (await text(rp, "#rWords")) === "3", "resume: the resumed practice finishes with all its words", await text(rp, "#rWords"));
await rp.click("#newBtn"); await rp.waitForTimeout(200);
ok(!(await vis(rp, "#resumeBtn")) && (await rp.evaluate(() => localStorage.getItem("jpq:resume"))) === "null", "resume: finishing clears it");
await rp.click("#startBtn"); await rp.waitForTimeout(300); await rp.click("#quitBtn"); await rp.waitForTimeout(200);
ok(await vis(rp, "#resumeBtn") && /3 left/.test(await text(rp, "#resumeBtn")), "resume: starting a new practice replaces the one to resume", await text(rp, "#resumeBtn"));
ok(rp.errors.length === 0, "resume: no page errors", rp.errors.join(" | "));

// ---------- 13. the 5-minute tour from the welcome pop-up ----------
for (const width of [900, 375]) {
  const tctx = await browser.newContext();
  const tp = await newPage(tctx, { width });
  const tag = width < 500 ? "phone" : "wide";
  ok(await vis(tp, "#tourBtn") && /5-minute tour/.test(await text(tp, "#tourBtn")), `tour (${tag}): the welcome pop-up offers the tour`);
  if (width > 500) await tp.locator("#welcome").screenshot({ path: join(out, "13-welcome-tour.png") });
  await tp.click("#tourBtn"); await tp.waitForTimeout(400);
  ok(!(await tp.evaluate(() => document.querySelector("#welcome").open)) && await tp.evaluate(() => localStorage.getItem("qcard:mode")) === "local" && await vis(tp, ".tourcard"), `tour (${tag}): starts as a guest with the tour card`);
  const titles = [];
  for (let i = 0; i < 40 && await vis(tp, ".tourcard"); i++) {
    const title = await text(tp, ".tourcard .tourtitle");
    if (titles.at(-1) !== title) titles.push(title);
    if (["Pick a set", "Your turn", "The result", "Kanji lists"].includes(title) || (width < 500 && ["The answer box", "Settings"].includes(title)))
      await tp.screenshot({ path: join(out, `13-tour-${tag}-${title.toLowerCase().replace(/[^a-z]+/g, "-")}.png`) });
    if (title === "That's the tour!") break;
    if (title === "Your turn") { await scribble(tp); await tp.waitForTimeout(100); }
    await tp.click('.tourcard [data-tour="next"]'); await tp.waitForTimeout(500);
  }
  const want = ["Welcome to the tour", "Pick a set", "Direction", "Modes", "Kanji learned up to", "Start practicing", "The question", "The answer box", "Furigana", "Writing tools", "Your turn", "The result", "Stop any time", "Pick up where you left off", "The vocab table", "Your sets", "Add your own sets", "Kanji lists", "Back to practice", "Settings", "That's the tour!"];
  ok(want.every((t) => titles.includes(t)), `tour (${tag}): goes from the welcome step through practice, the vocab table and Settings to the end`, titles.join(" › "));
  ok(await vis(tp, "#setup") && await vis(tp, "#resumeBtn"), `tour (${tag}): ends back on the practice page, with the practice left midway to resume`);
  await tp.click('.tourcard [data-tour="close"]'); await tp.waitForTimeout(200);
  ok(!(await vis(tp, ".tourcard")) && !(await vis(tp, ".tourspot")), `tour (${tag}): Keep going as a guest closes it`);
  ok(tp.errors.length === 0, `tour (${tag}): no page errors`, tp.errors.join(" | "));
  await tctx.close();
}

// ---------- 14. asking to share handwriting after every 10th practice; what's saved; Settings ----------
// Sharing is offered to developers only for now (the owner, 2026-10-22), so this account is one; everyone else is checked below.
const sctx = await browser.newContext();
const sp = await newPage(sctx, { init: () => {
  if (localStorage.getItem("fake:user")) return;
  localStorage.setItem("fake:user", JSON.stringify({ uid: "t1", displayName: "Share Test", email: "share@example.com" }));
  localStorage.setItem("fake:fs", JSON.stringify({
    "users/t1/meta/samples": { offeredAt: "x" },
    "users/t1/sets/one": { collection: "S", unit: "U", name: "One", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }] },
    "users/t1/data/prefs": { practices: 9, dir: "je", selected: ["one"] },
    "dev/t1": { role: "dev" },
  }));
} });
await sp.waitForTimeout(600);
const training = async () => Object.entries(await fsData(sp)).filter(([p]) => p.startsWith("users/t1/training/"));
const practiceOnce = async (how = "#selfGot") => {
  await sp.click("#startBtn"); await sp.waitForTimeout(300);
  await scribble(sp); await scribble(sp); await sp.click("#checkBtn"); await sp.waitForTimeout(200);
  await sp.click(how); await sp.waitForTimeout(1500);
};
const shareOpen = () => sp.evaluate(() => document.querySelector("#shareAsk").open);
await practiceOnce();
ok(await vis(sp, "#results") && await shareOpen(), "share: the 10th finished practice asks to share handwriting");
ok(/schools or other companies/.test(await text(sp, "#shareAsk")) && /models already trained on it stay/.test(await text(sp, "#shareAsk")) && /16 or older/.test(await text(sp, "#shareAsk")), "share: the question says where shared handwriting can go, what deleting can't undo, and the age");
ok(!(await vis(sp, "#shareNeverRow")) && /finished 10 practices/.test(await text(sp, "#shareCount")), "share: the first time there's no \"Don't ask me again\"", await text(sp, "#shareCount"));
await sp.locator("#shareAsk").screenshot({ path: join(out, "14-share-ask.png") });
await sp.click("#shareNo"); await sp.waitForTimeout(200);
ok(!(await shareOpen()) && !(await training()).length, "share: Not now closes it and nothing is saved");
await sp.click("#newBtn"); await sp.waitForTimeout(200);
await practiceOnce();
ok(!(await shareOpen()), "share: the 11th practice doesn't ask");
await sp.click("#newBtn"); await sp.waitForTimeout(200);
await sp.evaluate(() => localStorage.setItem("jpq:practices", "19"));
await practiceOnce();
ok(await shareOpen() && await vis(sp, "#shareNeverRow"), "share: the 20th practice asks again, now with \"Don't ask me again\"");
await sp.locator("#shareAsk").screenshot({ path: join(out, "14-share-ask-again.png") });
await sp.click("#shareYes"); await sp.waitForTimeout(1300);
ok((await fsData(sp))["users/t1/data/prefs"]?.share?.on === true, "share: Yes is saved with the account's choices");
await sp.click("#newBtn"); await sp.waitForTimeout(200);
await practiceOnce();
let tr = await training();
const rec = tr[0]?.[1], st = rec?.main?.s?.[0];
ok(tr.length === 1 && rec.word.kanji === "水" && rec.dir === "je" && rec.checker.verdict === "unmatched" && rec.student === "right", "share: an answer is saved to users/<uid>/training with the word, the checker's verdict and the student's own call", JSON.stringify(rec && { ...rec, main: undefined, furi: undefined }));
ok(rec?.main?.s?.length === 2 && st.xy.every((n) => typeof n === "number") && st.xy.length === 2 * st.t.length && st.t.length === st.f.length && st.dev === "mouse" && rec.main.s[1].at > 0,
  "share: each stroke keeps its points (a flat list), timing, pressure and pointer kind", JSON.stringify(st).slice(0, 160));
await sp.click("#settingsBtn"); await sp.waitForTimeout(200);
ok(await vis(sp, "#shareSet") && /^On since .*1 answer shared/.test(await text(sp, "#shareInfo")), "share: Settings shows it's on and how many answers were shared", await text(sp, "#shareInfo"));
await sp.locator("#shareSet").screenshot({ path: join(out, "14-share-settings.png") });
const [hdl] = await Promise.all([sp.waitForEvent("download"), sp.click("#shareDl")]);
const hfile = JSON.parse(readFileSync(await hdl.path(), "utf8")), ha = hfile.answers?.[0];
ok(/^japanese-vocab-handwriting-.*\.json$/.test(hdl.suggestedFilename()) && hfile.answers.length === 1 && ha.word.kanji === "水" && ha.main.s[0].t.length > 1 && typeof ha.main.s[1].at === "number",
  "share: Download what I've shared saves every shared answer with its strokes and their timing", hdl.suggestedFilename());
await sp.click("#shareDel"); await sp.click("#shareDelYes"); await sp.waitForTimeout(300);
ok(!(await training()).length && /0 answers shared/.test(await text(sp, "#shareInfo")) && !(await vis(sp, "#shareDel")), "share: Delete what I've shared removes every saved answer", await text(sp, "#shareInfo"));
await sp.click("#shareToggle"); await sp.waitForTimeout(200);
ok(/^Off\./.test(await text(sp, "#shareInfo")) && (await text(sp, "#shareToggle")) === "Turn on…", "share: Turn off stops it");
await sp.click("#settingsClose"); await sp.click("#newBtn"); await sp.waitForTimeout(200);
await practiceOnce();
ok(!(await training()).length, "share: nothing is saved once it's turned off");
// quitting midway saves what's written for Resume; the account's copy must hold only flat lists (Firestore can't store nested ones)
await sp.click("#newBtn"); await sp.waitForTimeout(200);
await sp.click("#startBtn"); await sp.waitForTimeout(300); await scribble(sp); await sp.click("#quitBtn"); await sp.waitForTimeout(1300);
const rink = (await fsData(sp))["users/t1/data/prefs"]?.resume?.ink?.main?.s?.[0]?.p;
ok(Array.isArray(rink) && rink.length > 4 && rink.every((n) => typeof n === "number"), "resume: the writing saved for Resume reaches the account (flat list of numbers)", JSON.stringify(rink)?.slice(0, 80));
await sp.click("#settingsBtn"); await sp.click("#shareToggle"); await sp.waitForTimeout(200);
ok(await shareOpen() && !(await vis(sp, "#shareNeverRow")) && !(await text(sp, "#shareCount")), "share: Turn on… in Settings asks the same question, without the count or the checkbox");
await sp.click("#shareNo");
await sp.click("#settingsClose");
ok(sp.errors.length === 0, "share: no page errors", sp.errors.join(" | "));
// a developer (dev/<uid>, made in the Firebase console) gets Dev tools in Settings to open the question themselves
const op = await newPage(sctx);
await op.waitForTimeout(600); await op.click("#settingsBtn"); await op.waitForTimeout(200);
ok(await vis(op, "#devSet"), "dev tools: a developer sees them in Settings");
await op.locator("#devSet").screenshot({ path: join(out, "14-dev-tools.png") });
const asked = () => op.evaluate(() => JSON.parse(localStorage.getItem("jpq:share"))?.asked);
const askedBefore = await asked();
await op.click("#devAsk1"); await op.waitForTimeout(200);
ok(await op.evaluate(() => document.querySelector("#shareAsk").open) && !(await vis(op, "#shareNeverRow")) && /finished 10 practices/.test(await text(op, "#shareCount")), "dev tools: First time opens the question as first asked");
await op.click("#shareNo"); await op.click("#devAsk2"); await op.waitForTimeout(200);
ok(await vis(op, "#shareNeverRow") && /finished 20 practices/.test(await text(op, "#shareCount")), "dev tools: Later times opens it with \"Don't ask me again\"");
await op.click("#shareNo");
ok((await asked()) === askedBefore, "dev tools: opening it doesn't count as being asked");
ok(op.errors.length === 0, "dev tools: no page errors", op.errors.join(" | "));
// guests are never asked: their handwriting stays in the browser
const gp = await newPage(await browser.newContext(), { init: () => {
  if (localStorage.getItem("qcard:mode")) return;
  const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
  localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
  put("sets/g", { collection: "G", unit: "U", name: "One", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }] });
  localStorage.setItem("jpq:practices", "9"); localStorage.setItem("jpq:dir", '"je"'); localStorage.setItem("jpq:selected", '["g"]');
} });
await gp.click("#startBtn"); await gp.waitForTimeout(300); await scribble(gp); await gp.click("#checkBtn"); await gp.waitForTimeout(200); await gp.click("#selfGot"); await gp.waitForTimeout(1500);
ok(await vis(gp, "#results") && !(await gp.evaluate(() => document.querySelector("#shareAsk").open)) && !(await vis(gp, "#shareSet")), "share: a guest's 10th practice doesn't ask, and Settings has no sharing section");
// for now, a signed-in account that isn't a developer isn't asked either, and a yes from before saves nothing
const np = await newPage(await browser.newContext(), { init: () => {
  if (localStorage.getItem("fake:user")) return;
  localStorage.setItem("fake:user", JSON.stringify({ uid: "n1", displayName: "Not Dev", email: "n@example.com" }));
  localStorage.setItem("fake:fs", JSON.stringify({
    "users/n1/meta/samples": { offeredAt: "x" },
    "users/n1/sets/one": { collection: "S", unit: "U", name: "One", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }] },
    "users/n1/data/prefs": { practices: 9, dir: "je", selected: ["one"] },
  }));
} });
await np.waitForTimeout(600);
const npPractice = async () => { await np.click("#startBtn"); await np.waitForTimeout(300); await scribble(np); await np.click("#checkBtn"); await np.waitForTimeout(200); await np.click("#selfGot"); await np.waitForTimeout(1500); };
await npPractice();
ok(await vis(np, "#results") && !(await np.evaluate(() => document.querySelector("#shareAsk").open)), "share: an account that isn't a developer isn't asked on its 10th practice (developers only for now)");
await np.click("#settingsBtn"); await np.waitForTimeout(200);
ok(!(await vis(np, "#shareSet")) && !(await vis(np, "#devSet")), "share: its Settings has no sharing section and no Dev tools");
await np.click("#settingsClose"); await np.click("#newBtn"); await np.waitForTimeout(200);
await np.evaluate(() => localStorage.setItem("jpq:share", JSON.stringify({ on: true, at: "2026-10-01T00:00:00Z" })));
await npPractice();
ok(!Object.keys(await fsData(np)).some((k) => k.startsWith("users/n1/training/")), "share: a yes from before saves nothing for an account that isn't a developer");
ok(np.errors.length === 0, "share (not a developer): no page errors", np.errors.join(" | "));

// ---------- 15. sample sets: an offer cut short is finished next time; an account with its own sets gets none ----------
for (const [label, seed, want] of [
  ["an offer cut short (the page closed midway) is finished next time", { "users/t2/sets/samples-food": { collection: "Sample sets", unit: "Week 2", name: "Food", words: [] } }, 6],
  ["an account with its own sets and no record of the offer gets none", { "users/t2/sets/mine": { collection: "Mine", unit: "1", name: "A", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }] } }, 0],
]) {
  const c = await browser.newContext();
  const p = await newPage(c, { init: (seed) => {
    if (localStorage.getItem("fake:user")) return;
    localStorage.setItem("fake:user", JSON.stringify({ uid: "t2", displayName: "Sample Test", email: "s@example.com" }));
    localStorage.setItem("fake:fs", JSON.stringify(seed));
  }, initArg: seed });
  await p.waitForTimeout(800);
  const d = await fsData(p), n = Object.keys(d).filter((k) => /^users\/t2\/sets\/samples-/.test(k)).length;
  ok(n === want && !!d["users/t2/meta/samples"], "samples: " + label, `${n} sample sets, offered: ${!!d["users/t2/meta/samples"]}`);
  ok(p.errors.length === 0, "samples: no page errors", p.errors.join(" | "));
  await c.close();
}

// ---------- 16. leaving a practice at an awkward moment; words of different sets that share an id ----------
const qctx = await browser.newContext();
const qp = await newPage(qctx, { init: () => {
  if (localStorage.getItem("qcard:mode")) return;
  const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
  localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
  put("sets/q-c", { collection: "Q", unit: "U", name: "C", words: [{ id: "x", en: "water", kana: "みず", kanji: "水" }, { id: "y", en: "tea", kana: "おちゃ", kanji: "お茶" }, { id: "z", en: "rice", kana: "ごはん", kanji: "" }] });
  // A hand-made file may number each set's words 1, 2, …
  put("sets/q-a", { collection: "Q", unit: "U", name: "A", words: [{ id: "1", en: "water", kana: "みず", kanji: "水" }, { id: "2", en: "tea", kana: "おちゃ", kanji: "お茶" }] });
  put("sets/q-b", { collection: "Q", unit: "U", name: "B", words: [{ id: "1", en: "rice", kana: "ごはん", kanji: "" }, { id: "2", en: "meat", kana: "にく", kanji: "肉" }] });
  localStorage.setItem("jpq:selected", '["q-c"]'); localStorage.setItem("jpq:dir", '"je"');
} });
const qGot = async () => { for (let i = 0; i < 8 && await vis(qp, "#quiz"); i++) { await scribble(qp); await qp.click("#checkBtn"); await qp.waitForTimeout(150); await qp.click("#selfGot"); await qp.waitForTimeout(1300); } };
await qp.click("#startBtn"); await qp.waitForTimeout(300);
const q1 = await text(qp, "#qText");
await scribble(qp); await qp.click("#checkBtn"); await qp.waitForTimeout(150);
ok(await vis(qp, "#selfCheck"), "quit while self-marking: (the self-marking panel waits)");
await qp.click("#quitBtn"); await qp.waitForTimeout(200);
await qp.click("#resumeBtn"); await qp.waitForTimeout(300);
ok((await text(qp, "#qText")) === q1 && /^0 of 3 done/.test(await text(qp, "#progLbl")) && !(await qp.$eval("#checkBtn", (b) => b.disabled)),
  "quit while self-marking: Resume asks that question again, with what was written", `${q1} → ${await text(qp, "#qText")}, ${await text(qp, "#progLbl")}`);
if (await qp.$eval("#checkBtn", (b) => b.disabled)) await scribble(qp);
await qp.click("#checkBtn"); await qp.waitForTimeout(150); await qp.click("#selfGot"); await qp.waitForTimeout(200);
await qp.click("#quitBtn"); await qp.click("#resumeBtn"); await qp.waitForTimeout(100);
const q2 = await text(qp, "#qText");
await qp.waitForTimeout(1400);
ok(await vis(qp, "#quiz") && (await text(qp, "#qText")) === q2 && /^1 of 3 done/.test(await text(qp, "#progLbl")), "Quit and Resume during the 花丸: the word resumed on stays, none is skipped", `${q2} → ${await text(qp, "#qText")}`);
await qGot();
await qp.click("#newBtn"); await qp.waitForTimeout(200);
await qp.click('[data-set="q-c"]'); await qp.click('[data-set="q-a"]'); await qp.click('[data-set="q-b"]'); await qp.click("#startBtn"); await qp.waitForTimeout(300);
await qGot();
ok(await vis(qp, "#results") && [await text(qp, "#rWords"), await text(qp, "#rFirst"), await text(qp, "#rTries")].join(",") === "4,4,4",
  "words of different sets with the same id are each their own question: all right first time", [await text(qp, "#rWords"), await text(qp, "#rFirst"), await text(qp, "#rTries")].join(","));
ok(qp.errors.length === 0, "awkward moments: no page errors", qp.errors.join(" | "));
// A check still running (the checker loading over a slow connection) when the student quits and starts another practice.
const cctx = await browser.newContext();
const cp = await newPage(cctx, { init: () => {
  if (localStorage.getItem("qcard:mode")) return;
  const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
  localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
  put("sets/c", { collection: "C", unit: "U", name: "C", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }, { id: "b", en: "tea", kana: "おちゃ", kanji: "お茶" }, { id: "c", en: "to eat", kana: "たべる", kanji: "食べる" }] });
  put("data/users/local/settings", { history: true });
  put("data/users/local/t1", { finishedAt: "2026-10-20T10:00:00Z", dir: "ej", mode: "default", sets: ["U › C"], words: [{ id: "a", en: "water", jp: "水", dir: "ej", tries: 3 }] });
  localStorage.setItem("jpq:selected", '["c"]');
} });
await cp.route("**/data/templates.json", async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue(); });
await cp.click("#startBtn"); await cp.waitForTimeout(300);
await scribble(cp); await cp.click("#checkBtn"); await cp.waitForTimeout(150);
ok(await vis(cp, "#checking"), "quit while checking: (still checking)");
await cp.click("#quitBtn"); await cp.click("#startBtn"); await cp.waitForTimeout(2500);
const cres = await cp.evaluate(() => JSON.parse(localStorage.getItem("jpq:resume")));
ok(!(await vis(cp, "#feedback")) && !(await vis(cp, "#selfCheck")) && /^0 of 3 done/.test(await text(cp, "#progLbl")) && !Object.keys(cres?.tries || {}).length,
  "quit while checking: the old answer isn't marked on the new practice's first question", JSON.stringify(cres?.tries));
await cp.click("#quitBtn"); await cp.waitForTimeout(200);
// History's "Practice these" with Verb forms picked: the words on the list are whole words, so they're practiced in Default.
await cp.click("#mode-verb"); await cp.click("#histAll"); await cp.waitForTimeout(300); await cp.click("#hPractise"); await cp.waitForTimeout(300);
ok(await vis(cp, "#quiz") && /^0 of 1 done/.test(await text(cp, "#progLbl")) && (await text(cp, "#qText")) === "water", "Practice these with Verb forms picked: practices the listed words (in Default)", `${await text(cp, "#progLbl")} ${await text(cp, "#qText")}`);
await cp.click(await vis(cp, "#quiz") ? "#quitBtn" : "#newBtn"); await cp.waitForTimeout(200);
ok(await cp.$eval("#mode-default", (b) => b.getAttribute("aria-pressed") === "true") && await cp.evaluate(() => Object.keys(localStorage).filter((k) => /data\/users\/local\/t\d/.test(k)).length) === 1,
  "Practice these with Verb forms picked: Default is picked after, and no empty session is saved");
ok(cp.errors.length === 0, "quit while checking: no page errors", cp.errors.join(" | "));
// The welcome pop-up closed with Escape is remembered like its X.
const ectx = await browser.newContext();
let ep = await newPage(ectx);
await ep.keyboard.press("Escape"); await ep.waitForTimeout(200);
ok(!(await ep.evaluate(() => document.querySelector("#welcome").open)) && await ep.evaluate(() => localStorage.getItem("qcard:mode")) === "local", "welcome: Escape closes it as a guest, like the X");
await ep.close(); ep = await newPage(ectx);
ok(!(await ep.evaluate(() => document.querySelector("#welcome").open)), "welcome: after Escape it doesn't come back on the next visit");

// ---------- 17. another account on this browser: sharing handwriting isn't carried over; a set with no collection ----------
const actx = await browser.newContext();
const ap = await newPage(actx, { init: () => {
  if (localStorage.getItem("fake:seeded")) return;
  localStorage.setItem("fake:seeded", "1");
  localStorage.setItem("fake:user", JSON.stringify({ uid: "a1", displayName: "A", email: "a@example.com" }));
  localStorage.setItem("fake:fs", JSON.stringify({
    "dev/a1": { role: "dev" }, "dev/b1": { role: "dev" }, "dev/c1": { role: "dev" }, // sharing is for developers only for now
    "users/a1/meta/samples": { offeredAt: "x" }, "users/a1/data/prefs": { share: { on: true, at: "2026-10-01T00:00:00Z" } },
    "users/b1/meta/samples": { offeredAt: "x" }, "users/b1/data/prefs": { dir: "je", selected: ["one"] }, "users/c1/meta/samples": { offeredAt: "x" },
    // saved without a collection (a hand-made file can leave it out): shown under "No collection"
    "users/b1/sets/one": { unit: "U", name: "One", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }] },
  }));
} });
await ap.waitForTimeout(600);
const signOut = async () => { await ap.click("#settingsBtn"); await ap.click("#signOutBtn"); await ap.waitForTimeout(800); };
const signIn = async (u) => { await ap.evaluate((u) => { window.__nextUser = u; }, u); await ap.click("#settingsBtn"); await ap.click("#signOutBtn"); await ap.waitForTimeout(1200); };
await ap.click("#settingsBtn");
ok(/^On since/.test(await text(ap, "#shareInfo")), "share, another account: (the first account shares its handwriting)", await text(ap, "#shareInfo"));
await ap.click("#settingsClose");
await signOut(); await signIn({ uid: "b1", displayName: "B", email: "b@example.com" });
await ap.click("#settingsBtn");
ok(/b@example\.com/.test(await text(ap, "#acctName")) && /^Off\./.test(await text(ap, "#shareInfo")), "share, another account: an account that never said yes isn't sharing", await text(ap, "#shareInfo"));
await ap.click("#settingsClose");
await ap.click("#startBtn"); await ap.waitForTimeout(300); await scribble(ap); await ap.click("#checkBtn"); await ap.waitForTimeout(200); await ap.click("#selfGot"); await ap.waitForTimeout(1500);
ok(!Object.keys(await fsData(ap)).some((k) => k.startsWith("users/b1/training/")), "share, another account: none of its handwriting is saved");
await ap.click("#newBtn"); await ap.waitForTimeout(200);
ok(await vis(ap, '[data-set="one"]') && await vis(ap, '#pickChs [data-k="0"]'), "no collection: (the set and its unit show)");
await ap.click('#pickChs [data-k="0"]'); await ap.click("#dir-ej"); await ap.waitForTimeout(1300);
ok((await fsData(ap))["users/b1/data/prefs"]?.dir === "ej", "no collection: choices are still saved to the account (Firestore refuses an empty field name)", JSON.stringify((await fsData(ap))["users/b1/data/prefs"]?.dir));
await signOut();
await ap.evaluate(() => localStorage.setItem("jpq:share", JSON.stringify({ on: true, at: "2026-10-01T00:00:00Z" }))); // another account said yes on this browser
await signIn({ uid: "c1", displayName: "C", email: "c@example.com" });
await ap.click("#settingsBtn");
ok(/c@example\.com/.test(await text(ap, "#acctName")) && /^Off\./.test(await text(ap, "#shareInfo")) && !(await fsData(ap))["users/c1/data/prefs"]?.share,
  "share, another account: a first sign-in doesn't take this browser's yes along", await text(ap, "#shareInfo"));
ok(ap.errors.length === 0, "another account: no page errors", ap.errors.join(" | "));

await browser.close(); server.close();
console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);

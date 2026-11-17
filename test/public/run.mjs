// Browser tests for the public site (index.html) with Firebase replaced by test/public/fake-firebase.js
// and any request to Anthropic's API recorded (there should be none). Run: node test/public/run.mjs  (needs Playwright; PLAYWRIGHT_DIR overrides where it lives)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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
const entry = ['import "./src/account/firebase.js";'];
if (process.env.WITH_CHECKER !== "0" && existsSync(join(root, "src/checking/checker.js"))) entry.push('import "./src/checking/checker.js";');
const bundle = async (plugins = []) => (await esbuild.build({
  stdin: { contents: entry.join("\n"), resolveDir: root, sourcefile: "test-entry.js" },
  bundle: true, format: "iife", write: false, alias: { "firebase/app": fake, "firebase/auth": fake, "firebase/firestore": fake }, plugins,
})).outputFiles[0].text;
const platformJs = await bundle();

const TYPES = { ".txt": "text/plain", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".woff2": "font/woff2" };
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
ok(!(await page.$("#palPick:not(#settings *)")) && !(await vis(page, "#settingsBtn")) && (await text(page, "#acctLabel")) === "Test Student",
  "top bar: signed in, the gear steps aside and the account shows the Google name (no colour dots)", await text(page, "#acctLabel"));
// Settings is a page of its own with tabs: open it (unless it's open: from the gear, or signed in the account menu) and pick the tab that has what's wanted.
const setOpen = (p) => p.evaluate(() => !document.querySelector("#settings").hidden);
// Vocabulary from the menu (☰ first on a narrower screen).
const goView = async (p, v) => { if (!(await p.locator(`#sideNav [data-go="${v}"]`).isVisible())) { await p.click("#menuBtn"); await p.waitForTimeout(300); } await p.click(`#sideNav [data-go="${v}"]`); await p.waitForTimeout(300); };
const goTable = (p) => goView(p, "table");
const settings = async (p, tab) => {
  if (!(await setOpen(p))) { if (await vis(p, "#settingsBtn")) await p.click("#settingsBtn"); else { await p.click("#acctBtn"); await p.click('#acctList [data-acct="settings"]'); } }
  if (tab) await p.click(`#setNav [data-set-tab="${tab}"]`);
};
await page.click("#acctBtn");
ok(await vis(page, "#acctList") && /Signed in as student@example\.com/.test(await text(page, "#acctList")) && (await page.$$eval("#acctList [role=menuitem]", (bs) => bs.map((b) => b.textContent.trim()).join(", "))) === "Settings, Sign out"
  && await page.evaluate(() => document.activeElement.dataset.acct === "settings"), "account menu: who's signed in, then Settings and Sign out", await text(page, "#acctList"));
await page.keyboard.press("ArrowDown");
ok(await page.evaluate(() => document.activeElement.dataset.acct === "signout"), "account menu: arrow keys move between its items");
await page.keyboard.press("Escape");
ok(!(await vis(page, "#acctList")) && await page.evaluate(() => document.activeElement.id === "acctBtn"), "account menu: Escape closes it");
await page.click("#acctBtn"); await page.mouse.click(300, 600);
ok(!(await vis(page, "#acctList")), "account menu: a click elsewhere closes it");
await page.click("#acctBtn"); await page.click('#acctList [data-acct="settings"]');
ok(await setOpen(page) && !(await vis(page, "#setup")) && await page.evaluate(() => document.querySelector('#setNav [aria-current="page"]')?.dataset.setTab === "look" && getComputedStyle(document.querySelector("#palPick")).display !== "none" && !document.querySelector("#acctName").getClientRects().length),
  "settings: the account menu's Settings opens a page with tabs down the side, Appearance first, the other tabs' parts not shown");
ok(await page.evaluate(() => [...document.querySelectorAll("#setNav [data-set-tab]")].filter((b) => !b.hidden).map((b) => b.textContent).join(", ")) === "Appearance, Account, Data, Developer tools",
  "settings: the tabs (no Handwriting sharing where it isn't offered, no Admin for an account that isn't a developer)");
await settings(page, "account");

ok(await page.evaluate(() => document.querySelector("#acctName").getClientRects().length > 0 && !document.querySelector("#palPick").getClientRects().length) && /student@example\.com/.test(await text(page, "#acctName")) && (await text(page, "#signOutBtn")) === "Sign out" && (await text(page, "#delStart")) === "Delete my account", "settings: shows the signed-in account, Sign out and Delete my account", await text(page, "#acctName"));
ok(await vis(page, "#nickRow") && (await page.$eval("#nickIn", (i) => i.placeholder)) === "Test Student" && await page.$eval("#nickSave", (b) => b.disabled), "settings: signed in, Account has a nickname field");
await page.fill("#nickIn", "  Kumo  "); await page.click("#nickSave"); await page.waitForTimeout(300);
ok((await text(page, "#acctLabel")) === "Kumo" && JSON.stringify(await fsData(page)).includes('"nickname":"Kumo"') && /Saved/.test(await text(page, "#nickMsg")), "nickname: saved with the account and shown at the top right", await text(page, "#acctLabel"));
await page.screenshot({ path: join(out, "1-nickname.png") });
await page.click("#settingsClose");
ok(!(await setOpen(page)) && await vis(page, "#setup"), "settings: ← Back closes it, back to the page it was opened from");
ok(await vis(page, '[data-set="samples-greetings"]') && await vis(page, "#sampleNote"), "new account: starts with the sample sets");
ok((await page.$eval("#uptoSel", (s) => s.value)) === "auto", "samples: 'Kanji learned up to' starts at Highest unit of the picked sets", await page.$eval("#uptoSel", (s) => s.value));
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
// Right-clicking a set, or holding a finger on a unit, shows its words on a card that can't be edited; neither picks anything.
const pickedNow = () => page.$$eval("#setPicker [data-set][aria-pressed=true]", (bs) => bs.map((b) => b.dataset.set).join(","));
const picked0 = await pickedNow();
await page.click('[data-set="samples-greetings"]', { button: "right" }); await page.waitForTimeout(200);
const wc = () => page.evaluate(() => ({ open: document.querySelector("#wordCard").open, title: document.querySelector("#wordCardTitle").textContent, rows: document.querySelectorAll("#wordCard tbody tr:not(.wset)").length,
  sets: document.querySelectorAll("#wordCard .wset").length, heads: [...document.querySelectorAll("#wordCard thead th")].map((t) => t.textContent).join(","), inputs: document.querySelectorAll("#wordCard input, #wordCard [contenteditable]").length,
  w: document.querySelector("#wordCard").getBoundingClientRect().width }));
const greet = await page.evaluate(() => S.sets.find((s) => s.id === "samples-greetings").words.filter(wordReady).length).catch(() => -1);
const c1 = await wc();
ok(c1.open && / › Greetings$/.test(c1.title) && c1.rows > 0 && (greet < 0 || c1.rows === greet) && c1.sets === 0 && /^English,Kana/.test(c1.heads) && !c1.inputs && c1.w < 1280 - 100 && (await pickedNow()) === picked0,
  "word card: right-clicking a set shows its words (English, Kana, Kanji) on a card as wide as they need, and picks nothing", JSON.stringify(c1));
await page.locator("#wordCard").screenshot({ path: join(out, "2-word-card.png") });
await page.click("#wordCardX"); await page.waitForTimeout(150);
await page.evaluate(() => {
  const b = document.querySelector('#pickChs [data-k]:not([data-k="all"])'), r = b.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true, clientX: r.left + 5, clientY: r.top + 5 };
  b.dispatchEvent(new PointerEvent("pointerdown", o)); window.__holdO = o;
});
await page.waitForTimeout(700);
// The chip on screen now (the list can be drawn again meanwhile, and a real tap lands on what's there).
await page.evaluate(() => { const b = document.querySelector('#pickChs [data-k]:not([data-k="all"])'); b.dispatchEvent(new PointerEvent("pointerup", window.__holdO)); b.click(); });
await page.waitForTimeout(150);
const c2 = await wc(), shownAfter = await shownSets();
ok(c2.open && / › /.test(c2.title) && c2.rows > 0 && shownAfter.split(",").length === 6, "word card: holding a unit shows the words of its sets, and the tap that ends the hold doesn't change what's shown", JSON.stringify(c2));
await page.keyboard.press("Escape"); await page.waitForTimeout(150);
ok(!(await page.evaluate(() => document.querySelector("#wordCard").open)), "word card: Escape closes it");
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
ok(await setOpen(page) && await page.evaluate(() => document.querySelector('#setNav [aria-current="page"]')?.dataset.setTab === "data") && await vis(page, "#importPreview"), "import: the empty state's Import opens Settings on Data with the preview");
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
await goView(page, "history");
ok(/Turn on progress tracking\?/.test(await text(page, "#hEmpty")) && !(await page.$("#histPanel")), "history question (account): an account is asked first, on the Progress page (no recent practice card)");
await page.click('#hEmpty [data-hist="on"]'); await page.waitForTimeout(300); await goView(page, "setup");
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
  const { writeWord, rng, boxesIn, loopBox, lineInBox } = await import("../checker/synth.mjs");
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
  // Settings → Developer tools (everyone has it, all off at first): live reading and character boxes, used on the 2nd word
  await settings(page, "tools"); await page.waitForTimeout(200);
  ok(await vis(page, "#toolsSet") && !(await page.isChecked("#liveReadOn")) && !(await page.isChecked("#charBoxesOn")), "developer tools: in Settings, everything off at first");
  await page.check("#liveReadOn"); await page.check("#charBoxesOn"); await page.click("#settingsClose");
  // pixels of the box colours (--ok, --shu) on a writing box
  const markPx = (sel) => page.evaluate((s) => {
    const c = document.querySelector(s), x = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, cs = getComputedStyle(document.documentElement);
    const rgb = (v) => { const d = document.createElement("div"); d.style.color = v; document.body.append(d); const m = getComputedStyle(d).color.match(/\d+/g).map(Number); d.remove(); return m; };
    const cols = [rgb(cs.getPropertyValue("--ok")), rgb(cs.getPropertyValue("--shu"))];
    let n = 0;
    for (let i = 0; i < x.length; i += 4) if (x[i + 3] > 200 && cols.some(([r, g, b]) => Math.abs(x[i] - r) + Math.abs(x[i + 1] - g) + Math.abs(x[i + 2] - b) < 40)) n++;
    return n;
  }, sel);
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
    await write(answer, 7 + step);
    if (step === 1) {
      await page.waitForTimeout(700);
      const live = await text(page, "#liveRead");
      ok(await vis(page, "#liveRead") && /^Reads 「.+」 · would fail: .+ · \d+ ms$/.test(live), "developer tools: live reading shows what the checker reads, its verdict and the time", live);
      ok(await markPx("#mainPad") > 20, "developer tools: character boxes drawn with the live reading");
    }
    await page.click("#checkBtn"); await page.waitForTimeout(600);
    const wrong = await vis(page, "#feedback"), self = await vis(page, "#selfCheck");
    seen.push({ answer, wrong, self, reason: wrong ? await text(page, "#fbReason") : "" });
    if (step === 0) ok(!wrong && !self, "built-in: correct kana is accepted", `${answer}${wrong ? " → " + seen[0].reason : ""}`);
    if (step === 1) {
      ok(wrong && !!seen[1].reason, "built-in: a different word is marked wrong, with a reason", `${answer} for ${kana}: ${seen[1].reason}`);
      ok(/^The checker read: 「.+」$/.test(await text(page, "#fbRead")), "built-in: a wrong answer shows what the checker read", await text(page, "#fbRead"));
      ok(!(await vis(page, "#liveRead")) && await markPx("#mainPad") > 20, "developer tools: after Check the live line goes and the character boxes stay on the answer");
      await page.evaluate(() => { localStorage.removeItem("jpq:liveRead"); localStorage.removeItem("jpq:charBoxes"); });
      ok((await text(page, "#overrideBtn")) === "Mark it as correct →" && (await text(page, "#feedback .stamp")) === "もう一度" && await page.$eval("#overrideBtn", (b) => b.classList.contains("btn")), "retry card: もう一度, with a Mark it as correct button");
    }
    if (step === 2) ok(!wrong && !self, "built-in: correct kanji is accepted", `${answer}${wrong ? " → " + seen[2].reason : ""}`);
    if (self) await page.click("#selfGot");
    else if (wrong) await page.click("#nextBtn");
    await page.waitForTimeout(1300);
  }
  ok(await vis(page, "#results"), "built-in practice reaches the results page");
  ok(await page.evaluate(() => window.QCardChecker.verify({ strokes: [[[0, 0], [10, 10]]], candidates: ["龘"], box: { w: 100, h: 100 } }).ok === null),
    "built-in: a character without a template comes back unchecked (self-marked)");
  // 〜 marks a slot (〜さん): it may be written or left out where the answer has one, and is extra writing elsewhere
  {
    const w = writeWord("さん", 11, { boxW: 400, boxH: 120, level: 0.3, mouse: false, swap: 0, reverse: 0, join: 0, lateDakuten: 0 });
    const xs = w.strokes.flat().map(([x]) => x), ys = w.strokes.flat().map(([, y]) => y);
    const x0 = Math.min(...xs), em = (Math.max(...xs) - x0) / 2, mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const wave = Array.from({ length: 24 }, (_, i) => [x0 + (em * 0.85 * i) / 23, mid - Math.sin((i / 23) * 2 * Math.PI) * em * 0.12]);
    const withWave = [wave, ...w.strokes.map((s) => s.map(([x, y]) => [x + em * 1.1, y]))];
    const v = (strokes, cand) => page.evaluate(([s, c, b]) => window.QCardChecker.verify({ strokes: s, candidates: [c], box: b }).ok, [strokes, cand, { w: w.box.w + em * 1.2, h: w.box.h }]);
    ok(await v(withWave, "〜さん") === true && await v(w.strokes, "〜さん") === true, "built-in: a 〜 may be written or left out where the answer has one");
    ok(await v(withWave, "さん") === false, "built-in: a 〜 where the answer has none is extra writing");
  }
  // Strokes: the right kanji with a stroke left out, added, swapped, standing in for another or not crossing fails;
  // any order, touch-ups and pieces pass
  {
    const O = { boxW: 300, boxH: 200, level: 0.3, mouse: false, swap: 0, reverse: 0, join: 0, lateDakuten: 0 };
    const verify = (strokes) => page.evaluate((s) => window.QCardChecker.verify({ strokes: s, candidates: ["夜"], box: { w: 300, h: 200 } }), strokes);
    const y = writeWord("夜", 11, O).strokes; // 丶 一 ノ 丨 ノ フ 丶 ㇏
    const lean = y[2].map(([x, py]) => [x + 3, py + 9]); // a second ノ under the first: 彳 where 夜 has 亻
    const res = async (s) => { const r = await verify(s); return r.ok ? "ok" : r.chars[0].why + ":" + r.chars[0].strokes; };
    ok(await res(y) === "ok" && await res(y.slice().reverse()) === "ok", "built-in: 夜 passes in any stroke order");
    const h = y[1], half = h.length >> 1;
    ok(await res([...y, h.map(([x, py]) => [x + 1, py + 1])]) === "ok" && await res([y[0], h.slice(0, half + 1), h.slice(half), ...y.slice(2)]) === "ok",
      "built-in: a stroke gone over again, or drawn in two pieces, still passes");
    ok(await res(y.filter((_, i) => i !== 6)) === "strokes:missing", "built-in: 夜 without its inner dot fails as a missing stroke", await res(y.filter((_, i) => i !== 6)));
    ok(await res([...y, lean]) === "strokes:extra", "built-in: 夜 with an extra ノ fails as an extra stroke", await res([...y, lean]));
    ok((await res([...y.filter((_, i) => i !== 6), lean])).startsWith("strokes") || (await res([...y.filter((_, i) => i !== 6), lean])).startsWith("shape"),
      "built-in: 夜 with 彳 for 亻 and no inner dot fails", await res([...y.filter((_, i) => i !== 6), lean]));
    const dotOnEnd = [...y.filter((_, i) => i !== 6), y[7].slice(Math.floor(y[7].length * 0.75))];
    ok(await res(dotOnEnd) === "strokes:wrong", "built-in: 夜 with its inner dot drawn on the end of ㇏ fails", await res(dotOnEnd));
    const other = async (ch, s) => { const r = await page.evaluate(([c, st]) => window.QCardChecker.verify({ strokes: st, candidates: [c], box: { w: 300, h: 200 } }), [ch, s]); return r.ok ? "ok" : r.chars[0].why + ":" + r.chars[0].strokes; };
    const a = writeWord("暑", 11, O).strokes, third = a[10].map(([x, py], i) => [x, (py + a[11][Math.min(i, a[11].length - 1)][1]) / 2]);
    ok(await other("暑", a) === "ok" && await other("暑", [...a.slice(0, 11), third, a[11]]) === "strokes:extra",
      "built-in: 暑 passes, 暑 with 目 for its bottom 日 fails as an extra stroke", await other("暑", [...a.slice(0, 11), third, a[11]]));
    const hr = writeWord("春", 11, O).strokes, late = [...hr.slice(0, 4), hr[4].slice(Math.floor(hr[4].length * 0.35)), ...hr.slice(5)];
    ok(await other("春", hr) === "ok" && await other("春", late) === "strokes:crossing",
      "built-in: 春 passes, 春 with ㇏ starting below the third line fails as strokes not crossing", await other("春", late));
    const s5 = hr[4], cut = s5.length >> 1, piecesLast = [...hr.slice(0, 4), s5.slice(0, cut + 1), ...hr.slice(5), s5.slice(cut)];
    ok(await other("春", piecesLast) === "ok", "built-in: 春's ㇏ drawn in two pieces, the second at the end, still passes", await other("春", piecesLast));
    // Pen strokes don't matter, only the lines drawn: a box drawn in one go, as a loop, is the same kanji
    const kai = writeWord("回", 11, O), r = rng(5), inner = [2, 3, 4]; // 丨 ㇕ around 丨 ㇕ 一, then the outer 一
    const loops = loopBox(loopBox(kai.strokes, inner, r), [0, 1, 3], r), line = lineInBox(kai.strokes, inner).at(-1);
    ok(JSON.stringify(boxesIn(kai.strokes, kai.spans[0][2])) === "[[0,1,5],[2,3,4]]" && loops.length === 2 && await other("回", loops) === "ok",
      "built-in: 回 with each box drawn in one go, as a loop, passes", await other("回", loops));
    ok(await other("回", [...loops, line]) === "strokes:extra" && await other("回", [...kai.strokes, line]) === "strokes:extra",
      "built-in: 回 with one more line across its inner box fails as an extra stroke, drawn as loops or not", await other("回", [...loops, line]) + " " + await other("回", [...kai.strokes, line]));
  }
  // A look-alike reads as the character asked for: ー written like 一 in ジュース, so the answer still matches
  {
    const w = writeWord("ジュ一ス", 11, { boxW: 400, boxH: 120, level: 0.3, mouse: false, swap: 0, reverse: 0, join: 0, lateDakuten: 0 });
    const r = await page.evaluate(([s, b]) => window.QCardChecker.verify({ strokes: s, candidates: ["ジュース"], box: b, anyKana: true }), [w.strokes, w.box]);
    ok(r.ok === true && r.text === "ジュース", "built-in: ジュース with its ー written like 一 reads as ジュース", JSON.stringify(r.text));
  }
  // Size: a plain い written smallish is fine (ぃ is never written); つ for っ is "should be written small", naming つ
  {
    const O = { boxW: 400, boxH: 120, level: 0.3, mouse: false, swap: 0, reverse: 0, join: 0, lateDakuten: 0 };
    const bbx = (S) => { const xs = S.flat().map(([x]) => x), ys = S.flat().map(([, y]) => y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
    const verify = (strokes, cands, more) => page.evaluate(([s, c, m]) => window.QCardChecker.verify({ strokes: s, candidates: c, box: { w: 400, h: 120 }, ...m }), [strokes, cands, more || {}]);
    const k = writeWord("暑", 11, O).strokes, i = writeWord("い", 11, O).strokes, a = bbx(k), b = bbx(i), em = a[3] - a[1];
    const smallI = k.concat(i.map((s) => s.map(([x, y]) => [a[2] + 0.15 * em + (x - b[0]) * 0.6, a[3] + (y - b[3]) * 0.6])));
    ok((await verify(smallI, ["暑い"])).ok === true, "built-in: a plain い written a little small is accepted");
    const tsu = await verify(writeWord("がつこう", 11, O).strokes, ["がっこう"]), bad = tsu.chars.find((c) => !c.ok);
    ok(tsu.ok === false && bad?.ch === "っ" && bad.why === "small" && bad.got === "つ", "built-in: つ written for っ fails as \"should be written small\"", JSON.stringify(bad));
    // a tap of the pen far from the writing is not read as part of it
    const f = writeWord("ほくせい", 11, O).strokes, c = bbx(f), fe = c[3] - c[1];
    const tap = [[c[2] + 3 * fe, c[1] + fe / 2], [c[2] + 3 * fe + 1, c[1] + fe / 2]];
    ok((await verify(f.concat([tap]), ["ほくせい", "ほく", "せい"], { anyKana: true })).ok === true && (await verify([tap, ...f], ["ほくせい"], { anyKana: true })).ok === true,
      "built-in: a stray tap far from the furigana is ignored");
  }

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
await goTable(page);
const tset = '[data-sid="sample-ch1-a"]';
// The vocab editor: a set reads as plain text until Edit turns it into fields; nothing is saved until Save.
const leaveAsked = () => page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
await page.click(`${tset} [data-toggle]`);
const w1 = await text(page, `${tset} tbody td`);
ok(!!w1 && !(await page.$(`${tset} textarea, ${tset} input`)) && await vis(page, `${tset} .tseth [data-edit]`) && !(await page.$(`${tset} [data-save], ${tset} [data-delset]`)),
  "vocab table: an open set reads as plain text, with Edit beside its name", w1);
await page.click(`${tset} [data-edit]`);
ok((await page.$$eval(`${tset} textarea[data-f]`, (xs) => xs.length)) >= 3 && await vis(page, `${tset} [data-ef="name"]`) && await page.$eval(`${tset} [data-save]`, (b) => b.disabled) && (await text(page, `${tset} [data-discard]`)) === "Cancel"
  && !(await page.$(`${tset} [data-edit]`)) && /Editing/.test(await text(page, `${tset} .tsethead`)) && await page.evaluate(() => document.activeElement?.dataset.f === "en") && !(await leaveAsked()),
  "vocab table: Edit turns the set into fields with its details on top, and there's nothing to save yet");
await page.fill(`${tset} [data-ef="tags"]`, " Quiz 1,quiz 1 、 Food  and drink, ");
ok(/Unsaved changes/.test(await text(page, `${tset} .tsethead`)) && await page.$eval(`${tset} [data-ef="tags"]`, (i) => i.classList.contains("chg") && document.activeElement === i) && !(await page.$eval(`${tset} [data-save]`, (b) => b.disabled))
  && (await text(page, `${tset} [data-discard]`)) === "Discard changes" && await leaveAsked(), "vocab table: a changed field is marked, the set says Unsaved changes, and the browser asks before the page is left");
await page.click("#backBtn");
ok(await vis(page, "#table") && /^1 set has unsaved changes\./.test(await text(page, "#leaveAsk")), "vocab table: ← Back with unsaved changes asks what to do with them", await text(page, "#leaveAsk"));
await page.click("#leaveAsk [data-lkeep]");
ok(!(await vis(page, "#leaveAsk")) && await vis(page, "#table") && /Quiz 1/.test(await page.$eval(`${tset} [data-ef="tags"]`, (i) => i.value)), "vocab table: Keep editing stays, with the changes");
await page.click(`${tset} [data-save]`); await page.waitForTimeout(400);
ok(!(await page.$(`${tset} textarea`)) && await vis(page, `${tset} [data-edit]`) && !(await leaveAsked()), "vocab table: after Save the set reads as text again");
data = await fsData(page);
ok(JSON.stringify(data["users/u1/sets/sample-ch1-a"]?.tags) === '["Quiz 1","Food and drink"]', "tags: saved from Edit, tidied and without repeats", JSON.stringify(data["users/u1/sets/sample-ch1-a"]?.tags));
ok((await page.$$eval(`${tset} .tag`, (xs) => xs.map((x) => x.textContent).join("|"))) === "Quiz 1|Food and drink", "tags: shown on the set in the vocab table");
{ const en = `${tset} tr:first-child textarea[data-f="en"]`, saved = async () => (await fsData(page))["users/u1/sets/sample-ch1-a"].words[0].en;
  await page.click(`${tset} [data-edit]`);
  const tall = await page.$eval(en, (t) => t.offsetHeight);
  await page.fill(en, "a phrase long enough that it can't fit on one line of its field, so the field has to grow to show all of it");
  ok(await page.$eval(en, (t) => t.classList.contains("chg") && t.scrollWidth <= t.clientWidth + 1) && (await page.$eval(en, (t) => t.offsetHeight)) > tall && (await page.$$eval(`${tset} textarea.chg`, (x) => x.length)) === 1,
    "vocab table: a long phrase wraps in its field instead of scrolling, and only the changed field is marked");
  await page.locator(tset).screenshot({ path: join(out, "5-tags-table.png") });
  await page.press(en, "Enter");
  ok(await page.evaluate(() => document.activeElement?.dataset.f === "kana") && !/\n/.test(await page.$eval(en, (t) => t.value)), "vocab table: Enter goes on to the next field");
  await page.click(`${tset} [data-discard]`);
  ok(!(await page.$(`${tset} textarea`)) && (await text(page, `${tset} tbody td`)) === w1 && (await saved()) === w1, "vocab table: Discard changes puts the set back as it was saved");
  await page.click(`${tset} [data-edit]`); await page.fill(en, w1 + "!"); await page.click("#backBtn"); await page.click("#leaveAsk [data-ldiscard]");
  ok(await vis(page, "#setup") && (await saved()) === w1, "vocab table: Discard all on leaving saves nothing");
  await goTable(page);
  ok(!(await page.$(`${tset} textarea`)) && (await text(page, `${tset} tbody td`)) === w1, "vocab table: coming back, the set isn't being edited any more");
  await page.click(`${tset} [data-edit]`); await page.fill(en, w1 + "!"); await page.click("#backBtn"); await page.click("#leaveAsk [data-lsave]"); await page.waitForTimeout(400);
  ok(await vis(page, "#setup") && (await saved()) === w1 + "!", "vocab table: Save all on leaving saves, then goes back to practice", await saved());
  await goTable(page);
  await page.dblclick(`${tset} tbody tr:nth-child(2) td[data-f="kana"]`);
  ok(!(await page.$(`${tset} textarea`)), "vocab table: double-clicking a word doesn't start editing (only Edit does)");
  await page.click(`${tset} [data-edit]`);
  await page.fill(en, w1);
  await page.click(`${tset} [data-add]`); await page.keyboard.type("spare"); await page.click(`${tset} tr:last-child [data-del]`);
  await page.click(`${tset} [data-save]`); await page.waitForTimeout(400);
  ok((await saved()) === w1 && !(await page.$(`${tset} textarea`)), "vocab table: (the word is back as it was; an added row taken out again isn't saved)", JSON.stringify((await fsData(page))["users/u1/sets/sample-ch1-a"].words.length)); }
ok(!(await page.$("#table #exportBtn")), "export / import: no longer in the vocab table");
await settings(page, "data");
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
await settings(page, "look"); await page.click('#themePick [data-theme-pick="dark"]'); await page.click('#palPick [data-pal="claude"]'); await page.click("#settingsClose");
await page.waitForTimeout(1300);
data = await fsData(page);
const prefs = data["users/u1/data/prefs"] || {};
ok(prefs.dir === "je" && prefs.mode === "kana" && prefs.theme === "dark" && prefs.palette === "claude" && prefs.selected?.includes("sample-ch1-a") && prefs.pickTags?.includes("quiz 1"), "choices: saved to the account", JSON.stringify(prefs).slice(0, 200));
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("jpq:")) localStorage.removeItem(k); });
await page.reload(); await page.waitForTimeout(1200);
ok(await pressed("#dir-je") && await pressed("#mode-kana") && await pressed('[data-set="sample-ch1-a"]') && await pressed('#pickTags [data-tag="quiz 1"]'), "choices: direction, mode, picked set and filter come back on another device");
ok(await page.evaluate(() => document.documentElement.dataset.theme === "dark" && document.documentElement.dataset.palette === "claude"), "choices: light or dark and colours come back too");
await page.click("#tagClear"); await page.click("#dir-ej"); await page.click("#mode-default");
await settings(page, "look"); await page.click('#themePick [data-theme-pick=""]'); await page.click('#palPick [data-pal="indigo"]'); await page.click("#settingsClose");
await page.waitForTimeout(1300);
ok((await fsData(page))["users/u1/data/prefs"]?.dir === "ej", "choices: later changes are saved again");
ok(!apiCalls.length, "nothing is ever sent to Anthropic", apiCalls.join(" "));
ok(!(await page.evaluate(() => window.__csp)).length, "no Content-Security-Policy violations", (await page.evaluate(() => window.__csp)).join(", "));

// ---------- 7. sign out, another person sees none of it ----------
await settings(page, "account"); await page.click("#signOutBtn"); await page.waitForTimeout(800);
ok(!(await page.evaluate(() => document.querySelector("#welcome").open)) && await vis(page, "#setup"), "sign out from Settings: no welcome pop-up after the first visit");
await page.evaluate(() => { window.__nextUser = { uid: "u2", displayName: "Other", email: "other@example.com" }; });
await settings(page, "account"); await page.click("#signOutBtn"); await page.waitForTimeout(600);
ok(await vis(page, '[data-set="samples-greetings"]') && !(await vis(page, '[data-set="sample-ch1-a"]')), "another account starts with only the sample sets");
ok(page.errors.length === 0, "no page errors", page.errors.join(" | "));
ok(!allRequests.some((r) => /fonts\.(googleapis|gstatic)\.com/.test(r.url)), "fonts: nothing requested from Google Fonts");

// ---------- 8. phone width ----------
const phone = await newPage(ctx, { width: 375 });
await phone.waitForTimeout(300);
const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
ok(wide <= 375, "phone: no sideways scrolling", String(wide));
await phone.screenshot({ path: join(out, "8-phone.png"), fullPage: true });
await settings(phone);
const onPhone = () => phone.evaluate(() => ({ nav: document.querySelector("#setNav").getClientRects().length > 0, body: document.querySelector(".setbody").getClientRects().length > 0, back: document.querySelector("#settingsClose").textContent, wide: document.documentElement.scrollWidth }));
let ph = await onPhone();
ok(ph.nav && !ph.body && ph.back === "← Back" && ph.wide <= 375, "phone: Settings opens as a list of its tabs", JSON.stringify(ph));
await phone.screenshot({ path: join(out, "8-settings-phone.png") });
await phone.click('#setNav [data-set-tab="account"]'); ph = await onPhone();
ok(!ph.nav && ph.body && ph.back === "← Settings" && ph.wide <= 375 && await phone.evaluate(() => document.querySelector("#signOutBtn").getClientRects().length > 0), "phone: picking a tab opens it in the list's place", JSON.stringify(ph));
await phone.screenshot({ path: join(out, "8-settings-phone-tab.png") });
await phone.click("#settingsClose"); ph = await onPhone();
ok(ph.nav && !ph.body && await setOpen(phone), "phone: ← Settings goes back to the list");
await phone.click("#settingsClose");
ok(!(await setOpen(phone)) && await vis(phone, "#setup"), "phone: ← Back from the list closes Settings");
// The menu: ☰ slides it in over the page.
const menuOpen = () => phone.evaluate(() => { const n = document.querySelector("#sideNav"), r = n.getBoundingClientRect(); return document.querySelector("#menuBtn").getAttribute("aria-expanded") === "true" && getComputedStyle(n).visibility === "visible" && r.left >= 0 && r.right <= innerWidth; });
ok(await vis(phone, "#menuBtn") && !(await menuOpen()), "phone: a ☰ button, the menu closed");
await phone.click("#menuBtn"); await phone.waitForTimeout(300);
ok(await menuOpen() && await phone.evaluate(() => [...document.querySelectorAll("#nbName, #sideNav > [data-go]")].map((b) => b.textContent.trim()).join(", ")) === "My notebook, Practice, Vocabulary, Progress, Extra tools" && await phone.evaluate(() => document.activeElement?.dataset.go === "setup"),
  "phone: ☰ slides in the menu (the notebook, then Practice, Vocabulary, Progress, Extra tools) and moves to Practice");
await phone.screenshot({ path: join(out, "8-menu-phone.png") });
await phone.click('#sideNav [data-go="history"]'); await phone.waitForTimeout(300);
ok(await vis(phone, "#history") && !(await menuOpen()), "phone: picking Progress in the menu goes there and closes the menu");
await phone.click("#menuBtn"); await phone.waitForTimeout(300); await phone.keyboard.press("Escape"); await phone.waitForTimeout(300);
ok(!(await menuOpen()) && await phone.evaluate(() => document.activeElement?.id === "menuBtn"), "phone: Escape closes the menu");
await phone.click("#menuBtn"); await phone.waitForTimeout(300); await phone.mouse.click(320, 500); await phone.waitForTimeout(300);
ok(!(await menuOpen()) && await vis(phone, "#history"), "phone: a tap beside the menu closes it");
await phone.click("#histBack");

await phone.close();

// ---------- 8b. delete an account: its data, then the Google account ----------
await goView(page, "history"); await page.click('#hEmpty [data-hist="on"]'); await page.waitForTimeout(300); await goView(page, "setup");
ok(!!(await fsData(page))["users/u2/data/settings"], "delete: (history setting saved, so there's something under data/)");
await page.click('[data-set="samples-greetings"]'); await page.click("#startBtn"); await page.waitForTimeout(300); await scribble(page); await page.click("#quitBtn"); await page.waitForTimeout(200);
ok(await vis(page, "#resumeBtn"), "delete: (a practice left midway, with writing, to resume)");
await settings(page, "account"); await page.click("#delStart");
ok(/deletes your account/.test(await text(page, "#delAcct")) && await vis(page, "#delYes"), "delete: asks before deleting");
await page.screenshot({ path: join(out, "8-delete.png") });
await page.click("#delNo");
ok(await vis(page, "#delStart") && !(await page.$("#delYes")), "delete: Cancel backs out");
await page.evaluate(() => { window.__oldSignIn = true; window.__signInError = "auth/popup-closed-by-user"; });
await page.click("#delStart"); await page.click("#delYes"); await page.waitForTimeout(600);
ok(/^Nothing was deleted: Google needs to confirm it's you first\. Try again\.$/.test(await text(page, "#delErr")) && Object.keys(await fsData(page)).some((p) => p.startsWith("users/u2/sets/")),
  "delete: with an old sign-in, Google's confirmation comes first; closing it deletes nothing and says so", await text(page, "#delErr"));
await page.click("#delNo");
await page.evaluate(() => { window.__signInError = null; window.__staleLogin = true; });
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
await settings(lp, "account");
ok(/Not signed in/.test(await text(lp, "#acctName")) && (await text(lp, "#signOutBtn")) === "Sign in with Google" && (await text(lp, "#delStart")) === "Delete local storage", "settings (guest): not signed in, offers Sign in and Delete local storage");
ok(!(await vis(lp, "#delTip")) && (await lp.hover("#delAcct .qtip"), await vis(lp, "#delTip")) && /treats you as a new user/.test(await text(lp, "#delTip")), "settings (guest): the ? beside Delete local storage explains it on hover");
await lp.screenshot({ path: join(out, "9-settings-delete-tip.png") });
ok((await text(lp, "#setStats")) === "6 sets · 55 words · 3 kanji lists", "settings: counts the sets, words and kanji lists", await text(lp, "#setStats"));
await settings(lp, "look"); await lp.click('#themePick [data-theme-pick="dark"]'); await lp.click('#palPick [data-pal="claude"]');
ok(await lp.evaluate(() => document.documentElement.dataset.theme === "dark" && document.documentElement.dataset.palette === "claude" && localStorage.getItem("jpq:theme") === '"dark"'), "settings: Dark and Warm apply and are remembered");
await lp.screenshot({ path: join(out, "9-settings-dark.png") });
await lp.click('#themePick [data-theme-pick="light"]'); await lp.click('#palPick [data-pal="indigo"]');
await lp.screenshot({ path: join(out, "9-settings.png") });
await settings(lp, "account"); await lp.click("#delStart"); await settings(lp, "look"); await settings(lp, "account");
ok((await text(lp, "#delStart")) === "Delete local storage", "settings: a Delete left waiting for its confirmation is dropped on leaving the tab");
await settings(lp, "data");
ok(/^On\./.test(await text(lp, "#histSetInfo")) && /saved only in this browser/.test(await text(lp, "#histSetWhere")) && (await text(lp, "#histSetToggle")) === "Turn off" && !(await vis(lp, "#histSetAll")), "settings (guest): Practice history is on without asking, and says where it's kept", await text(lp, "#histSetInfo"));
await lp.click("#histSetToggle"); await lp.waitForTimeout(200);
ok(/^Off, so finished practice sessions aren't saved/.test(await text(lp, "#histSetInfo")) && (await text(lp, "#histSetToggle")) === "Turn on" && await lp.evaluate(() => JSON.parse(localStorage.getItem("qcard:local:data/users/local/settings") || "null")?.history) === false, "settings: a guest can turn Practice history off there", await text(lp, "#histSetInfo"));
await lp.click("#histSetToggle"); await lp.waitForTimeout(200);
ok(/^On/.test(await text(lp, "#histSetInfo")) && await lp.evaluate(() => JSON.parse(localStorage.getItem("qcard:local:data/users/local/settings") || "null")?.history) === true, "settings: and on again");
await lp.evaluate(() => localStorage.removeItem("qcard:local:data/users/local/settings")); await lp.goto(base); await lp.waitForTimeout(500); // as before the choice was made

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
await goView(lp, "history");
ok(/No finished practice sessions yet/.test(await text(lp, "#hEmpty")) && !(await lp.$("#hEmpty [data-hist]")), "local: progress tracking is on for a guest without a question", await text(lp, "#hEmpty"));
await goView(lp, "setup");
await lp.click('[data-set="sample-ch1-b"]'); await lp.click("#dir-je"); await lp.click("#startBtn"); await lp.waitForTimeout(300);
for (let i = 0; i < 10 && await vis(lp, "#quiz"); i++) { await scribble(lp); await lp.click("#checkBtn"); await lp.waitForTimeout(150); await lp.click("#selfGot"); await lp.waitForTimeout(1400); }
ls = await lp.evaluate(() => Object.keys(localStorage).filter((k) => /^qcard:local:data\/users\/local\/t\d/.test(k)));
ok(ls.length === 1, "local: practice history saved in localStorage", String(ls.length));
// Settings → Practice history: export the history, then import a file that has that session, two new ones and a broken one
await settings(lp, "data");
{ const [hdl] = await Promise.all([lp.waitForEvent("download"), lp.click("#histExport")]);
  const hf = JSON.parse(readFileSync(await hdl.path(), "utf8")), s0 = hf.sessions?.[0];
  ok(/^japanese-vocab-history-.*\.json$/.test(hdl.suggestedFilename()) && hf.kind === "history" && hf.sessions.length === 1 && /^t\d+$/.test(s0.id) && s0.words?.length > 0 && s0.sets?.length === 1,
    "history export: one file with the session and its words", hdl.suggestedFilename());
  const fresh = (i) => ({ ...s0, id: "t" + (1700000000000 + i), finishedAt: new Date(Date.UTC(2025, 5, 1 + i)).toISOString() });
  const hfile = join(out, "history-import.json"), pickHist = async (f) => { const [ch] = await Promise.all([lp.waitForEvent("filechooser"), lp.click("#histImport")]); await ch.setFiles(f); await lp.waitForTimeout(200); };
  writeFileSync(hfile, JSON.stringify({ ...hf, sessions: [s0, fresh(1), fresh(2), { id: "nope", words: [] }] }));
  await pickHist(hfile);
  const prev = await text(lp, "#histImportPreview");
  ok(/2 new sessions to add/.test(prev) && /1 session already here/.test(prev) && /1 entry isn't valid/.test(prev) && (await text(lp, "#histImportGo")) === "Add 2 sessions", "history import: the preview counts new sessions, ones already here and broken ones", prev);
  await lp.screenshot({ path: join(out, "9-history-import.png") });
  await lp.click("#histImportGo"); await lp.waitForTimeout(300);
  ls = await lp.evaluate(() => Object.keys(localStorage).filter((k) => /^qcard:local:data\/users\/local\/t\d/.test(k)));
  ok(ls.length === 3 && /Added 2 sessions/.test(await text(lp, "#histPortMsg")) && /See all 3/.test(await text(lp, "#histSetAll")), "history import: merges, adding only the new sessions", `${ls.length} · ${await text(lp, "#histPortMsg")}`);
  await pickHist(hfile);
  ok(/Every session in this file is already here/.test(await text(lp, "#histImportPreview")) && !(await lp.$("#histImportGo")), "history import: the same file again has nothing to add");
  await lp.click("#histImportCancel");
  await pickHist(join(root, "test/public/fixtures/sample-export.json"));
  ok(/vocab file/.test(await text(lp, "#histPortMsg")) && !(await vis(lp, "#histImportPreview")), "history import: a vocab file is pointed to Settings → Data", await text(lp, "#histPortMsg"));
  await settings(lp, "data"); await (await lp.$("#importFile")).setInputFiles(hfile); await lp.waitForTimeout(200);
  ok(/progress file/.test(await text(lp, "#portMsg")), "vocab import: a progress file is pointed to its own import", await text(lp, "#portMsg"));
  await lp.click("#settingsClose"); }
await lp.close();
lp = await newPage(lctx);
await lp.waitForTimeout(300);
ok(await vis(lp, "#setup") && await vis(lp, '[data-set="sample-ch1-a"]') && !(await vis(lp, "#welcome")), "guest: coming back goes straight to the saved sets, no pop-up");
ok(!(await vis(lp, '[data-set="samples-greetings"]')), "samples: removed ones don't come back");
ok(await lp.evaluate(() => document.documentElement.dataset.theme === "light"), "settings: Light is still on after coming back");
await settings(lp, "look"); await lp.click('#themePick [data-theme-pick=""]');
ok(await lp.evaluate(() => !("theme" in document.documentElement.dataset)), "settings: Match device follows the device again");
await lp.evaluate(() => { window.__signInError = "auth/popup-blocked"; });
await settings(lp, "account"); await lp.click("#signOutBtn"); await lp.waitForTimeout(200);
ok(await setOpen(lp) && !(await lp.evaluate(() => document.querySelector("#welcome").open)) && /blocked the sign-in window/.test(await text(lp, "#acctErr")), "guest: Sign in with Google in Settings goes straight to Google (a blocked pop-up is explained there)");
await lp.evaluate(() => { window.__signInError = null; });
await lp.click("#signOutBtn"); await lp.waitForTimeout(1000);
await settings(lp, "account"); const acctNow = await text(lp, "#acctName"); await lp.click("#settingsClose");
ok(/student@example\.com/.test(acctNow) && await vis(lp, '[data-set="samples-greetings"]') && !(await vis(lp, '[data-set="sample-ch1-a"]')), "Sign in from local: switches to the new account, which starts with the samples");
ok(await lp.evaluate(() => localStorage.getItem("qcard:mode")) === null, "signed in: no longer remembered as local");
await settings(lp, "account"); await lp.click("#signOutBtn"); await lp.waitForTimeout(1000);
ok(!(await lp.evaluate(() => document.querySelector("#welcome").open)) && await vis(lp, "#setup"), "signed out: straight back to this browser's data, no pop-up");
ok(await vis(lp, '[data-set="sample-ch1-a"]'), "local data is still there after using an account");
await settings(lp, "look"); await lp.click('#palPick [data-pal="claude"]'); await settings(lp, "account"); await lp.click("#delStart");
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
await up.click('#groupSeg [data-view="Courses"]'); await up.waitForTimeout(200);
rows = await rowsOf("#pickChs");
ok(rows === "J1: All, Ch. 1, Ch. 2*", "units: an older course (chapters 1 to 2) covers units Ch. 1 and Ch. 2, and units in no course are hidden in that view", rows);
ok((await chipNames()) === "A · Food, Extras", "views: a unit the view hides takes its sets off the page too", await chipNames());
// Showing a row there doesn't touch the units that view hides: back on the main view they're as they were.
await up.click('#pickChs .pchrow:nth-child(1) [data-k="all"]'); await up.click('#groupSeg [data-view=""]'); await up.waitForTimeout(150);
rows = await rowsOf("#pickChs");
ok(rows === "Mine: All*, Week 1, Week 2, Week 10 | Nakama: All, Ch. 1*, Ch. 2*, Ch. 10", "views: showing a row there leaves the units that view hides as they were", rows);
await up.click('#pickChs .pchrow:nth-child(2) [data-k="0"]');
// The sets card: its heading with edit at the right end, and the line under the rows, there even with nothing picked.
const sumRow = () => up.evaluate(() => [document.querySelector("#pickSum").textContent, document.querySelector("#pickClear").textContent, document.querySelector("#pickClear").disabled].join("|"));
ok((await text(up, "#setup .panel .head h3")) === "Vocabulary sets" && !(await up.$("#toTable"))
  && await vis(up, "#pickSumRow") && (await sumRow()) === "0 sets picked|Pick all sets|false", "sets card: Vocabulary sets, no edit link; with no sets picked, Pick all sets", await sumRow());
await up.click("#pickClear");
ok((await sumRow()) === "5 sets picked|Clear all picks|false", "sets card: Pick all sets picks every set showing, then Clear all picks is offered", await sumRow());
await up.click("#pickClear");
await up.click('#pickChs .pchrow:nth-child(1) [data-k="all"]'); await up.click('#pickChs .pchrow:nth-child(2) [data-k="1"]');
ok(/No units shown\. Tap All or a unit above/.test(await text(up, "#setPicker")) && (await sumRow()) === "0 sets picked|Pick all sets|true", "sets card: with no units shown, Pick all sets is there but greyed out", await sumRow());
await up.click('#pickChs .pchrow:nth-child(1) [data-k="all"]'); await up.click('#pickChs .pchrow:nth-child(2) [data-k="1"]');
await goTable(up);
await up.fill("#nsCol", "mine"); await up.fill("#nsUnit", "week 2"); await up.fill("#nsName", "Weather");
await up.click('#newSetForm [type="submit"]'); await up.waitForTimeout(400);
ok(await up.evaluate(() => { const a = document.activeElement; return a?.dataset.f === "en" && !!a.closest(".tset.editing") && /Weather/.test(a.closest(".tset").querySelector(".tsethead").textContent); }), "vocab table: a set just added opens ready to type its first word");
const local = () => up.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("qcard:local:sets/")).map((k) => [k.slice(17), JSON.parse(localStorage.getItem(k))])));
let docs = await local(), added = Object.entries(docs).find(([, d]) => d.name === "Weather");
ok(added && added[1].collection === "Mine" && added[1].unit === "Week 2" && !("book" in added[1]), "units: a new set is saved with collection, unit and name, matching an existing unit whatever its case", JSON.stringify(added?.[1] ? { id: added[0], ...added[1], words: undefined } : null));
const ot = '[data-sid="n-1a"]';
await up.click('#tChs .pchrow:nth-child(2) [data-k="all"]'); await up.waitForTimeout(100);
await up.click(`${ot} [data-toggle]`); await up.click(`${ot} [data-edit]`);
ok((await up.$eval(`${ot} [data-ef="unit"]`, (i) => i.value)) === "Ch. 1" && (await up.$eval(`${ot} [data-ef="name"]`, (i) => i.value)) === "A · Hello", "units: Edit shows an older set as unit and name");
await up.fill(`${ot} [data-ef="name"]`, "A · Greetings"); await up.click(`${ot} [data-save]`); await up.waitForTimeout(400);
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
ok(!(await vis(rp, "header h1")) && !(await vis(rp, ".topr")), "practice: the title, the settings gear and the account are hidden while writing");
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
for (const width of [1280, 900, 375]) {
  const tctx = await browser.newContext();
  const tp = await newPage(tctx, { width });
  const tag = width < 500 ? "phone" : width < 1000 ? "wide" : "sidebar";
  ok(await vis(tp, "#tourBtn") && /5-minute tour/.test(await text(tp, "#tourBtn")), `tour (${tag}): the welcome pop-up offers the tour`);
  if (tag === "wide") await tp.locator("#welcome").screenshot({ path: join(out, "13-welcome-tour.png") });
  await tp.click("#tourBtn"); await tp.waitForTimeout(400);
  ok(!(await tp.evaluate(() => document.querySelector("#welcome").open)) && await tp.evaluate(() => localStorage.getItem("qcard:mode")) === "local" && await vis(tp, ".tourcard"), `tour (${tag}): starts as a guest with the tour card`);
  const titles = [];
  for (let i = 0; i < 40 && await vis(tp, ".tourcard"); i++) {
    const title = await text(tp, ".tourcard .tourtitle");
    if (titles.at(-1) !== title) titles.push(title);
    if (["Pick a set", "Your turn", "The result", "Kanji by unit"].includes(title) || (tag !== "wide" && ["The answer box", "Back to practice", "Settings"].includes(title)))
      await tp.screenshot({ path: join(out, `13-tour-${tag}-${title.toLowerCase().replace(/[^a-z]+/g, "-")}.png`) });
    if (title === "That's the tour!") break;
    if (title === "Your turn") { await scribble(tp); await tp.waitForTimeout(100); }
    if (title === "Vocabulary" && titles.filter((t) => t === "Vocabulary").length === 1) {
      const ring = await tp.evaluate(() => { const r = document.querySelector(".tourspot").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0; });
      ok(ring && (tag === "sidebar" ? /in the menu shows/ : /☰ opens the menu/).test(await text(tp, ".tourcard")), `tour (${tag}): the Vocabulary step rings something on screen (the sidebar's Vocabulary, or ☰ when the menu is closed)`, await text(tp, ".tourcard"));
    }
    await tp.click('.tourcard [data-tour="next"]'); await tp.waitForTimeout(500);
  }
  const want = ["Welcome to the tour", "Pick a set", "Direction", "Modes", "Kanji learned up to", "Start practicing", "The question", "The answer box", "Furigana", "Writing tools", "Your turn", "The result", "Stop any time", "Pick up where you left off", "Vocabulary", "Your sets", "Add your own sets", "Kanji by unit", "Back to practice", "Settings and your account", "That's the tour!"];
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
// Birth month and year: at is the picker (#bornAskIn in the pop-up after a yes, #bornIn in Settings). Someone whose 16th
// birthday may still be ahead this month counts as under 16; a month older is 16 for certain.
const pickBorn = async (p, at, m, y) => { for (const [k, v] of [["M", m], ["Y", y]]) { await p.click(`${at}${k} .dd-btn`); await p.click(`${at}${k} li[data-v="${v}"]`); } };
const bornOf = (back) => { const d = new Date(new Date().getFullYear() - 16, new Date().getMonth() - back, 1); return [String(d.getMonth() + 1).padStart(2, "0"), String(d.getFullYear()), d.toLocaleDateString("en", { month: "long" }) + " " + d.getFullYear()]; };
const [m15, y15, said15] = bornOf(0), [m16, y16, said16] = bornOf(1);
const acct = async (doc) => (await fsData(sp))["users/t1/data/" + doc];
const bornOpen = () => sp.evaluate(() => document.querySelector("#bornAsk").open);
await practiceOnce();
ok(await vis(sp, "#results") && await shareOpen(), "share: the 10th finished practice asks to share handwriting");
ok(/schools or other companies/.test(await text(sp, "#shareAsk")) && /models already trained on it stay/.test(await text(sp, "#shareAsk")) && /16 or older/.test(await text(sp, "#shareAsk")), "share: the question says where shared handwriting can go, what deleting can't undo, and the age");
ok(!(await vis(sp, "#shareNeverRow")) && /finished 10 practices/.test(await text(sp, "#shareCount")), "share: the first time there's no \"Don't ask me again\"", await text(sp, "#shareCount"));
ok(!(await sp.$("#shareAsk .dd")), "share: the question itself doesn't ask for a birth month and year");
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
await sp.click("#shareYes"); await sp.waitForTimeout(200);
ok(!(await shareOpen()) && await bornOpen() && (await text(sp, "#bornAskInM .dd-btn")) === "Month" && (await text(sp, "#bornAskInY .dd-btn")) === "Year" && /handwriting consent/.test(await text(sp, "#bornAskTipText")) && /once every 3 months/.test(await text(sp, "#bornAskNote")),
  "share: Yes is followed by a second pop-up asking for a birth month and year, with a (?) and a line that it can change once every 3 months", await text(sp, "#bornAskNote"));
await sp.locator("#bornAsk").screenshot({ path: join(out, "14-born-ask.png") });
await sp.click("#bornAskGo"); await sp.waitForTimeout(200);
ok(await bornOpen() && /Pick both/.test(await text(sp, "#bornAskErr")), "birth: without a month and year it asks for both and stays open", await text(sp, "#bornAskErr"));
await sp.click("#bornAskNo"); await sp.waitForTimeout(1300);
ok(!(await bornOpen()) && !(await acct("prefs"))?.share?.on && !(await acct("profile"))?.born, "birth: Cancel leaves sharing off and saves nothing");
await settings(sp, "account"); await sp.click("#shareToggle"); await sp.click("#shareYes"); await sp.waitForTimeout(200);
await sp.click("#bornAskInM .dd-btn"); await sp.click(`#bornAskInM li[data-v="${m16}"]`);
ok((await text(sp, "#bornAskInM .dd-btn")) !== "Month" && !(await acct("profile"))?.born, "birth: a month picked stays while the year is picked, and nothing is saved before Save");
await pickBorn(sp, "#bornAskIn", m16, y16);
await sp.click("#bornAskGo"); await sp.waitForTimeout(200);
ok(await sp.$eval("#askDlg", (d) => d.open) && (await text(sp, "#askTitle")) === `Is ${said16} correct?` && /once every 3 months/.test(await text(sp, "#askText")) && !(await acct("profile"))?.born,
  "birth: Save and continue asks \"Is <month year> correct?\" first, and saves nothing before Yes", await text(sp, "#askTitle"));
await sp.locator("#askDlg").screenshot({ path: join(out, "14-born-confirm.png") });
await sp.click("#askYes"); await sp.waitForTimeout(1300);
ok(!(await bornOpen()) && (await acct("prefs"))?.share?.on === true && (await acct("profile"))?.born === `${y16}-${m16}` && Date.now() - new Date((await acct("profile"))?.bornAt) < 60000,
  "share: with a month and year of 16 or older, the yes is saved with the account's choices and the month and year with the account", JSON.stringify(await acct("profile")));
await sp.click("#settingsClose");
await sp.click("#newBtn"); await sp.waitForTimeout(200);
await practiceOnce();
let tr = await training();
const rec = tr[0]?.[1], st = rec?.main?.s?.[0];
ok(tr.length === 1 && rec.word.kanji === "水" && rec.dir === "je" && rec.checker.verdict === "unmatched" && rec.student === "right", "share: an answer is saved to users/<uid>/training with the word, the checker's verdict and the student's own call", JSON.stringify(rec && { ...rec, main: undefined, furi: undefined }));
ok(rec?.main?.s?.length === 2 && st.xy.every((n) => typeof n === "number") && st.xy.length === 2 * st.t.length && st.t.length === st.f.length && st.dev === "mouse" && rec.main.s[1].at > 0,
  "share: each stroke keeps its points (a flat list), timing, pressure and pointer kind", JSON.stringify(st).slice(0, 160));
await settings(sp, "account"); await sp.waitForTimeout(200);
ok(await vis(sp, "#shareSet") && /^On since .*1 answer shared/.test(await text(sp, "#shareInfo")), "share: Settings shows it's on and how many answers were shared", await text(sp, "#shareInfo"));
await sp.locator("#shareSet").screenshot({ path: join(out, "14-share-settings.png") });
const [hdl] = await Promise.all([sp.waitForEvent("download"), sp.click("#shareDl")]);
const hfile = JSON.parse(readFileSync(await hdl.path(), "utf8")), ha = hfile.answers?.[0];
ok(/^japanese-vocab-handwriting-.*\.json$/.test(hdl.suggestedFilename()) && hfile.answers.length === 1 && ha.word.kanji === "水" && ha.main.s[0].t.length > 1 && typeof ha.main.s[1].at === "number",
  "share: Download what I've shared saves every shared answer with its strokes and their timing", hdl.suggestedFilename());
await sp.click("#shareDel"); await sp.click("#shareDelYes"); await sp.waitForTimeout(300);
ok(!(await training()).length && /0 answers shared/.test(await text(sp, "#shareInfo")) && !(await vis(sp, "#shareDel")), "share: Delete what I've shared removes every saved answer", await text(sp, "#shareInfo"));
await sp.click("#shareToggle"); await sp.waitForTimeout(200);
ok(/Change your mind at any time/.test(await text(sp, "#shareInfo")) && (await text(sp, "#shareToggle")) === "Turn on…", "share: Turn off stops it");
// the birth month and year is the account's now: a later yes doesn't ask again, and Settings → Account shows it
await sp.click("#shareToggle"); await sp.click("#shareYes"); await sp.waitForTimeout(200);
ok(!(await shareOpen()) && !(await bornOpen()) && /^On/.test(await text(sp, "#shareInfo")), "birth: with 16 or older on the account, Yes is all it takes the next time");
await settings(sp, "account"); await sp.waitForTimeout(200);
ok(await vis(sp, "#bornRow") && (await text(sp, "#bornNow")) === said16 && !(await vis(sp, "#bornIn")) && !(await vis(sp, "#bornSave")) && /can be changed after \w+ \d+, \d{4}/.test(await text(sp, "#bornNote")) && /advertising if we add it later/.test(await text(sp, "#bornTip")),
  "birth: Settings → Account shows it with its (?); given less than 3 months ago, it can't be changed and says when it can", `${await text(sp, "#bornNow")} / ${await text(sp, "#bornNote")}`);
await sp.locator('[data-set-pane="account"]').screenshot({ path: join(out, "14-birth-settings-wait.png") });
// 3 months on (the day it was given, moved back)
await sp.waitForTimeout(1000);
await sp.evaluate(() => { const fs = JSON.parse(localStorage.getItem("fake:fs")); fs["users/t1/data/profile"].bornAt = new Date(Date.now() - 100 * 86400e3).toISOString(); localStorage.setItem("fake:fs", JSON.stringify(fs)); });
await sp.reload(); await sp.waitForTimeout(800); await settings(sp, "account"); await sp.waitForTimeout(200);
ok(await vis(sp, "#bornIn") && (await text(sp, "#bornInY .dd-btn")) === y16 && await sp.$eval("#bornSave", (b) => b.disabled) && !(await text(sp, "#bornNote")), "birth: 3 months on, it can be changed: the dropdowns and Save are back", await text(sp, "#bornNote"));
await sp.locator('[data-set-pane="account"]').screenshot({ path: join(out, "14-birth-settings.png") });
await pickBorn(sp, "#bornIn", m15, y15); await sp.waitForTimeout(300);
ok((await acct("profile"))?.born === `${y16}-${m16}` && !(await sp.$eval("#bornSave", (b) => b.disabled)), "birth: picking saves nothing until Save is pressed");
await sp.click("#bornSave"); await sp.waitForTimeout(200);
ok(await sp.$eval("#askDlg", (d) => d.open) && (await text(sp, "#askTitle")) === `Is ${said15} correct?` && /once every 3 months/.test(await text(sp, "#askText")) && (await acct("profile"))?.born === `${y16}-${m16}`,
  "birth: Save asks \"Is <month year> correct?\" the same way, saying it can change once every 3 months", await text(sp, "#askText"));
await sp.click("#askYes"); await sp.waitForTimeout(1300);
ok((await acct("profile"))?.born === `${y15}-${m15}` && /Saved\..*off now/.test(await text(sp, "#bornMsg")) && (await acct("prefs"))?.share?.on === false && (await text(sp, "#bornNow")) === said15 && !(await vis(sp, "#bornIn")),
  "birth: changed to under 16 in Settings, it's saved, sharing goes off and it says so, and the 3 months start again", await text(sp, "#bornMsg"));
await settings(sp, "account");
ok(/Change your mind at any time/.test(await text(sp, "#shareInfo")), "birth: Settings shows sharing off", await text(sp, "#shareInfo"));
await sp.click("#settingsClose"); await sp.waitForTimeout(200);
await sp.evaluate(() => localStorage.setItem("jpq:practices", "29"));
await practiceOnce();
ok(await vis(sp, "#results") && !(await shareOpen()), "birth: an account known to be under 16 isn't asked on its 30th practice");
ok(!(await training()).length, "share: nothing is saved once it's turned off");
// quitting midway saves what's written for Resume; the account's copy must hold only flat lists (Firestore can't store nested ones)
await sp.click("#newBtn"); await sp.waitForTimeout(200);
await sp.click("#startBtn"); await sp.waitForTimeout(300); await scribble(sp); await sp.click("#quitBtn"); await sp.waitForTimeout(1300);
const rink = (await fsData(sp))["users/t1/data/prefs"]?.resume?.ink?.main?.s?.[0]?.p;
ok(Array.isArray(rink) && rink.length > 4 && rink.every((n) => typeof n === "number"), "resume: the writing saved for Resume reaches the account (flat list of numbers)", JSON.stringify(rink)?.slice(0, 80));
await settings(sp, "account"); await sp.click("#shareToggle"); await sp.waitForTimeout(200);
ok(await shareOpen() && !(await vis(sp, "#shareNeverRow")) && !(await text(sp, "#shareCount")), "share: Turn on… in Settings asks the same question, without the count or the checkbox");
await sp.click("#shareYes"); await sp.waitForTimeout(200);
ok(await bornOpen() && await vis(sp, "#bornAskYoung") && /16 and older/.test(await text(sp, "#bornAskYoung")) && (await text(sp, "#bornAskNow")) === said15 && !(await vis(sp, "#bornAskIn")) && !(await vis(sp, "#bornAskGo")) && /can be changed after/.test(await text(sp, "#bornAskNote")),
  "birth: an account under 16 that says yes is told sharing is for 16 and older, with no way to change the month and year for 3 months", await text(sp, "#bornAskNote"));
await sp.locator("#bornAsk").screenshot({ path: join(out, "14-born-ask-under-16.png") });
await sp.click("#bornAskNo"); await sp.waitForTimeout(200);
ok(!(await bornOpen()) && /Change your mind at any time/.test(await text(sp, "#shareInfo")), "birth: and sharing stays off");
await settings(sp, "account");
ok((await text(sp, "#bornClear")) === "Delete" && await sp.$eval("#bornClear", (b) => b.classList.contains("danger")), "birth: Delete, in red, beside the birthday");
await sp.click("#bornClear"); await sp.waitForTimeout(200);
ok(await sp.$eval("#askDlg", (d) => d.open) && /cleared from our database.*again any time after \w+ \d+, \d{4}/.test(await text(sp, "#askText")) && await sp.$eval("#askYes", (b) => b.classList.contains("danger")) && (await acct("profile"))?.born === `${y15}-${m15}`,
  "birth: Delete asks first, saying when it can be given again", await text(sp, "#askText"));
await sp.click("#askYes"); await sp.waitForTimeout(300);
ok((await acct("profile"))?.born === "" && /^Cleared on \w+ \d+, \d{4}$/.test(await text(sp, "#bornNow")) && /can be updated after \w+ \d+, \d{4}/.test(await text(sp, "#bornNote")) && !(await vis(sp, "#bornClear")) && !(await vis(sp, "#bornIn")) && /Cleared/.test(await text(sp, "#bornMsg")),
  "birth: deleted, it says when it was cleared and when it can be updated", `${await text(sp, "#bornNow")} / ${await text(sp, "#bornNote")}`);
await sp.click("#settingsClose");
ok(sp.errors.length === 0, "share: no page errors", sp.errors.join(" | "));
// Accounts are for 13 and older: a birthday under 13, once confirmed, closes the account (the owner, 2026-11-16). The month
// they turn 13 in gets the benefit of the doubt.
const bornAgo = (years, back) => { const d = new Date(new Date().getFullYear() - years, new Date().getMonth() - back, 1); return [String(d.getMonth() + 1).padStart(2, "0"), String(d.getFullYear())]; };
const yctx = await browser.newContext();
const yp = await newPage(yctx, { init: () => {
  if (localStorage.getItem("fake:seeded")) return;
  localStorage.setItem("fake:seeded", "1");
  localStorage.setItem("fake:user", JSON.stringify({ uid: "y1", displayName: "Young", email: "y@example.com" }));
  localStorage.setItem("fake:fs", JSON.stringify({ "users/y1/meta/samples": { offeredAt: "x" }, "users/y1/sets/one": { collection: "S", unit: "U", name: "One", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }] } }));
} });
await yp.waitForTimeout(600);
const yOpen = () => yp.evaluate(() => document.querySelector("#tooYoung").open);
await settings(yp, "account"); await yp.waitForTimeout(200);
const [m13, y13] = bornAgo(13, 0), [m12, y12] = bornAgo(13, -1);
await pickBorn(yp, "#bornIn", m13, y13); await yp.click("#bornSave"); await yp.click("#askYes"); await yp.waitForTimeout(600);
ok(!(await yOpen()) && (await fsData(yp))["users/y1/data/profile"]?.born === `${y13}-${m13}`, "13+: someone who may have turned 13 this month keeps the account");
await yp.evaluate(() => { const fs = JSON.parse(localStorage.getItem("fake:fs")); fs["users/y1/data/profile"].bornAt = ""; localStorage.setItem("fake:fs", JSON.stringify(fs)); });
await yp.reload(); await yp.waitForTimeout(800); await settings(yp, "account"); await yp.waitForTimeout(200);
await pickBorn(yp, "#bornIn", m12, y12); await yp.click("#bornSave"); await yp.waitForTimeout(200);
ok(/^Is \w+ \d{4} correct\?$/.test(await text(yp, "#askTitle")) && !/\b13\b/.test(await text(yp, "#askDlg")), "13+: the confirmation is the same neutral question, with nothing about 13", await text(yp, "#askDlg"));
await yp.click("#askYes"); await yp.waitForTimeout(600);
ok(await yOpen() && /13 or older/.test(await text(yp, "#tooYoung")) && /will be deleted/.test(await text(yp, "#tooYoung")) && /as a guest/.test(await text(yp, "#tooYoung")) && (await fsData(yp))["users/y1/data/profile"]?.born === `${y12}-${m12}`,
  "13+: confirmed under 13, the birthday is saved and a pop-up says accounts are for 13 and older, the account will be deleted, and guest practice stays", await text(yp, "#tooYoung"));
await yp.locator("#tooYoung").screenshot({ path: join(out, "14-too-young.png") });
await yp.keyboard.press("Escape"); await yp.waitForTimeout(200);
ok(await yOpen(), "13+: Escape doesn't close it");
await yp.reload(); await yp.waitForTimeout(1000);
ok(await yOpen(), "13+: it's back on the next visit until the account is gone");
await yp.evaluate(() => { window.__staleLogin = true; });
await yp.click("#tooYoungOk"); await yp.waitForTimeout(1500);
ok(!Object.keys(await fsData(yp)).some((p) => p.startsWith("users/y1/")) && (await yp.evaluate(() => JSON.parse(localStorage.getItem("fake:deleted") || "[]"))).includes("y1"),
  "13+: OK deletes the account's data and the Google account (through the same code as Delete my account)");
ok(!(await yOpen()) && !(await yp.evaluate(() => document.querySelector("#welcome").open)) && await yp.evaluate(() => localStorage.getItem("qcard:mode") === "local" && !localStorage.getItem("fake:user")),
  "13+: the page starts over as a guest, without the welcome pop-up");
ok(yp.errors.length === 0, "13+: no page errors", yp.errors.join(" | "));
await yctx.close();
// a developer (dev/<uid>, made in the Firebase console) gets Dev tools in Settings to open the question themselves
const op = await newPage(sctx);
await op.waitForTimeout(600); await settings(op, "admin"); await op.waitForTimeout(200);
ok(await vis(op, "#devSet") && await op.evaluate(() => !document.querySelector("#toolsSet #devAsk1") && !document.querySelector("#devSet #liveReadOn")), "admin: a developer gets an Admin tab in Settings, apart from the Developer tools everyone has");
await op.locator("#devSet").screenshot({ path: join(out, "14-dev-tools.png") });
const asked = () => op.evaluate(() => JSON.parse(localStorage.getItem("jpq:share"))?.asked);
const askedBefore = await asked();
await op.click("#devAsk1"); await op.waitForTimeout(200);
ok(await op.evaluate(() => document.querySelector("#shareAsk").open) && !(await vis(op, "#shareNeverRow")) && /finished 10 practices/.test(await text(op, "#shareCount")), "dev tools: First time opens the question as first asked");
await op.click("#shareNo"); await op.click("#devAsk2"); await op.waitForTimeout(200);
ok(await vis(op, "#shareNeverRow") && /finished 20 practices/.test(await text(op, "#shareCount")), "dev tools: Later times opens it with \"Don't ask me again\"");
await op.click("#shareNo");
ok((await asked()) === askedBefore, "dev tools: opening it doesn't count as being asked");
// Admin: the words of this round, during a practice
await op.check("#roundListOn"); await op.click("#settingsClose"); await op.waitForTimeout(200);
if (await vis(op, "#results")) { await op.click("#newBtn"); await op.waitForTimeout(200); }
await op.click("#startBtn"); await op.waitForTimeout(300);
const round = () => op.evaluate(() => [document.querySelector("#roundHead").textContent, document.querySelectorAll("#roundItems li").length, document.querySelector("#roundItems li.now")?.textContent].join("|"));
const nWords = await op.evaluate(() => +document.querySelector("#progLbl").textContent.match(/of (\d+)/)[1]);
ok(await vis(op, "#quiz") && await op.evaluate(() => !document.querySelector("#roundList").hidden) && (await round()).startsWith(`Round 1: ${nWords} to go|`), "admin: the round's words show under the progress bar", await round());
const [, nLi, nowLi] = (await round()).split("|"), q = await text(op, "#qText");
ok(nLi === String(nWords) && nowLi.includes(q), "admin: the round list has every word of the round, the one on screen first", `${await round()} / ${q}`);
await op.click("#quitBtn"); await op.waitForTimeout(300);
await settings(op, "admin"); await op.uncheck("#roundListOn");
// Admin: the privacy policy notice, now and as a returning visitor sees it
await op.click("#devPolicyNow"); await op.waitForTimeout(100);
ok(await vis(op, "#policyNote") && /The privacy policy was updated on \w+ \d+, \d{4}\. Read it/.test(await text(op, "#policyNote")), "admin: Show it now shows the privacy policy notice", await text(op, "#policyNote"));
await op.click("#policyClose");
await op.click("#devPolicyNext"); await op.waitForTimeout(1200); // the account's choices are saved a moment later
await op.reload(); await op.waitForTimeout(800);
ok(await vis(op, "#policyNote"), "admin: after Show it on my next visit, the notice comes on the next visit");
await op.click("#policyClose"); await op.waitForTimeout(1200);
ok((await fsData(op))["users/t1/data/prefs"]?.policySeen === await op.evaluate(() => JSON.parse(localStorage.getItem("jpq:policySeen"))) && !(await vis(op, "#policyNote")), "policy notice: closing it is saved with the account's choices", (await fsData(op))["users/t1/data/prefs"]?.policySeen);
// Admin: the 3 month wait on the birth month and year, ended for the developer's own account
await settings(op, "account"); await op.waitForTimeout(200);
const waiting = !(await vis(op, "#bornIn")) && !!(await fsData(op))["users/t1/data/profile"]?.bornAt;
await settings(op, "admin"); await op.click("#devBornReset"); await op.waitForTimeout(300);
const resetSaid = await text(op, "#devBornMsg");
await settings(op, "account"); await op.waitForTimeout(200);
ok(waiting && /wait is over/.test(resetSaid) && (await fsData(op))["users/t1/data/profile"]?.bornAt === "" && await vis(op, "#bornIn") && await vis(op, "#bornSave"), "admin: Reset the 3 month wait lets the birth month and year be given again", resetSaid);
// Admin: the tour, started as the signed-in developer
await settings(op, "admin"); await op.click("#devTour"); await op.waitForTimeout(400);
ok(await vis(op, "#setup") && await vis(op, ".tourcard") && /Welcome to the tour/.test(await text(op, ".tourcard")) && !/guest/.test(await text(op, ".tourcard")), "admin: Start the tour goes to Practice and starts the tour, without calling the account a guest", await text(op, ".tourcard"));
await op.click('.tourcard [data-tour="close"]'); await op.waitForTimeout(200);
ok(!(await vis(op, ".tourcard")) && await op.evaluate(() => localStorage.getItem("qcard:mode")) !== "local", "admin: the tour closes and the developer stays signed in");
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
await settings(np, "tools"); await np.waitForTimeout(200);
ok(await np.$eval("#shareSet", (e) => e.hidden) && !(await vis(np, '[data-set-tab="admin"]')) && await vis(np, "#toolsSet"), "share: its Settings has no Handwriting sharing in Account and no Admin tab (Developer tools itself is there)");
await np.click("#settingsClose"); await np.click("#newBtn"); await np.waitForTimeout(200);
await np.evaluate(() => localStorage.setItem("jpq:share", JSON.stringify({ on: true, at: "2026-10-01T00:00:00Z" })));
await npPractice();
ok(!Object.keys(await fsData(np)).some((k) => k.startsWith("users/n1/training/")), "share: a yes from before saves nothing for an account that isn't a developer");
await np.evaluate(() => localStorage.setItem("jpq:roundList", "true"));
await np.click("#newBtn"); await np.waitForTimeout(200); await np.click("#startBtn"); await np.waitForTimeout(300);
ok(await vis(np, "#quiz") && await np.evaluate(() => document.querySelector("#roundList").hidden), "admin: an account that isn't a developer never sees the round list, even with it switched on");
await np.click("#quitBtn"); await np.waitForTimeout(300);
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
ok(/^1 of 3 done/.test(await text(qp, "#progLbl")) && !(await qp.$("#maru")), "a right answer goes straight on to the next word, with no 花丸", await text(qp, "#progLbl"));
await qp.click("#quitBtn"); await qp.click("#resumeBtn"); await qp.waitForTimeout(100);
const q2 = await text(qp, "#qText");
await qp.waitForTimeout(1400);
ok(await vis(qp, "#quiz") && (await text(qp, "#qText")) === q2 && /^1 of 3 done/.test(await text(qp, "#progLbl")), "Quit and Resume right after a right answer: the word resumed on stays, none is skipped", `${q2} → ${await text(qp, "#qText")}`);
// Check with nothing written: the retry card with the answer, and nothing to mark as correct.
const emptyOn = !(await qp.$eval("#checkBtn", (b) => b.disabled));
// (Extra tools, #tools, once shared its id with the writing tools: it showed over every question, and the tools stayed after Check.)
const toolsOn = await vis(qp, "#writeTools") && !(await vis(qp, "#tools"));
await qp.click("#checkBtn"); await qp.waitForTimeout(200);
ok(toolsOn && !(await vis(qp, "#writeTools")) && !(await vis(qp, "#tools")) && await vis(qp, "#scratchPad"), "a practice: the writing tools show with a question and step aside once it's checked; Extra tools isn't on the page");
ok(emptyOn && await vis(qp, "#feedback") && !(await vis(qp, "#overrideBtn")) && /Nothing was written/.test(await text(qp, "#fbReason")) && !!(await text(qp, "#fbAnswer")),
  "Check with nothing written: it can be pressed, and shows the retry card with the answer", await text(qp, "#fbReason"));
await qp.click("#nextBtn"); await qp.waitForTimeout(200);
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
await cp.route("**/js/templates.js", async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue(); });
await cp.click("#startBtn"); await cp.waitForTimeout(300);
await scribble(cp); await cp.click("#checkBtn"); await cp.waitForTimeout(150);
ok(await vis(cp, "#checking"), "quit while checking: (still checking)");
await cp.click("#quitBtn"); await cp.click("#startBtn"); await cp.waitForTimeout(2500);
const cres = await cp.evaluate(() => JSON.parse(localStorage.getItem("jpq:resume")));
ok(!(await vis(cp, "#feedback")) && !(await vis(cp, "#selfCheck")) && /^0 of 3 done/.test(await text(cp, "#progLbl")) && !Object.keys(cres?.tries || {}).length,
  "quit while checking: the old answer isn't marked on the new practice's first question", JSON.stringify(cres?.tries));
await cp.click("#quitBtn"); await cp.waitForTimeout(200);
// History's "Practice these" with Verb forms picked: the words on the list are whole words, so they're practiced in Default.
await cp.click("#mode-verb"); await goView(cp, "history"); await cp.click("#hPractise"); await cp.waitForTimeout(300);
ok(await vis(cp, "#quiz") && /^0 of 1 done/.test(await text(cp, "#progLbl")) && (await text(cp, "#qText")) === "water", "Practice these with Verb forms picked: practices the listed words (in Default)", `${await text(cp, "#progLbl")} ${await text(cp, "#qText")}`);
await cp.click(await vis(cp, "#quiz") ? "#quitBtn" : "#newBtn"); await cp.waitForTimeout(200);
ok(await cp.$eval("#mode-default", (b) => b.getAttribute("aria-pressed") === "true") && await cp.evaluate(() => Object.keys(localStorage).filter((k) => /data\/users\/local\/t\d/.test(k)).length) === 1,
  "Practice these with Verb forms picked: Default is picked after, and no empty session is saved");
ok(cp.errors.length === 0, "quit while checking: no page errors", cp.errors.join(" | "));
// History: page buttons under the sessions (20 to a page) and under the hard words (5 to All a page); "Practice these" takes the words shown.
const hctx = await browser.newContext();
const hp = await newPage(hctx, { init: () => {
  if (localStorage.getItem("qcard:mode")) return;
  const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
  localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
  const words = Array.from({ length: 12 }, (_, i) => ({ id: "w" + i, en: "word " + i, kana: "かな" + i }));
  put("sets/h", { collection: "C", unit: "U", name: "H", words });
  // another set whose words are numbered the same way: they aren't the hard words and never come up with them
  put("sets/h2", { collection: "C", unit: "U", name: "H2", words: [0, 1, 2].map((i) => ({ id: "w" + i, en: "other " + i, kana: "べつ" + i })) });
  put("data/users/local/settings", { history: true });
  for (let i = 0; i < 45; i++) put("data/users/local/t" + (100 + i), { finishedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), dir: "ej", mode: "default", sets: ["U › H"],
    words: i ? [{ id: "w0", en: "word 0", jp: "かな0", dir: "ej", tries: 1 }] : words.map((w) => ({ id: w.id, en: w.en, jp: w.kana, dir: "ej", tries: 2 })) });
} });
await goView(hp, "history");
{ const fill = () => hp.evaluate(() => [Math.round(document.querySelector("#heat svg").getBoundingClientRect().width), document.querySelector("#heat").clientWidth,
    Math.round(document.querySelector("#heat rect").getBoundingClientRect().width), +document.querySelector("#heatTitle").textContent.match(/\d+/)[0]]);
  let [svgW, boxW, sq, wk] = await fill(); const narrow = svgW === boxW, sq0 = sq, wk0 = wk;
  await hp.setViewportSize({ width: 2000, height: 1000 }); await hp.waitForTimeout(300); [svgW, boxW, sq, wk] = await fill();
  ok(narrow && svgW === boxW && boxW > 1500 && wk > 53 && wk > wk0 && Math.abs(sq - sq0) <= 1, "history: the practice graph fills its card with more weeks, squares the same size", `${svgW}/${boxW} ${wk0}→${wk} weeks, ${sq0}→${sq}px`);
  await hp.setViewportSize({ width: 900, height: 1000 }); await hp.waitForTimeout(200); }
const hPage = () => hp.evaluate(() => [document.querySelectorAll("#hList > li").length, document.querySelector('#hPager [aria-current="page"]')?.textContent,
  [...document.querySelectorAll("#hPager .pg:not(.arrow):not(.gap)")].map((b) => b.textContent).join(" "), [...document.querySelectorAll("#hPager .arrow")].map((b) => b.disabled).join("/")].join(","));
ok(await vis(hp, "#hPager") && (await hPage()) === "20,1,1 2 3,true/false", "history pages: 20 sessions on page 1 of 3, Previous off", await hPage());
await hp.click('#hPager [data-pg="2"]');
ok((await hPage()) === "5,3,1 2 3,false/true", "history pages: page 3 has the oldest 5, Next off", await hPage());
await hp.click('#hPager .arrow[aria-label="Previous page"]');
ok((await hPage()) === "20,2,1 2 3,false/false", "history pages: Previous goes back a page", await hPage());
await hp.click("#sessPer .dd-btn"); await hp.click('#sessPer [data-v="10"]');
ok((await hPage()) === "10,1,1 2 3 4 5,true/false", "history pages: 10 per page gives 5 pages, back at page 1", await hPage());
await hp.click("#sessPer .dd-btn"); await hp.click('#sessPer [data-v="20"]');
const love = () => hp.evaluate(() => [document.querySelectorAll("#hLove > li").length, document.querySelector("#hPractise").textContent, document.querySelector("#loveCount").textContent,
  document.querySelector('#lovePager [aria-current="page"]')?.textContent || "-"].join(","));
ok((await love()) === "10,Practice these 10,1–10 of 11,1", "hard words: 10 to a page by default, with pages", await love());
await hp.click('#lovePager [data-pg="1"]');
ok((await love()) === "1,Practice this word,11 of 11,2", "hard words: page 2 has the last word, and Practice takes that page", await love());
await hp.click("#loveWin .dd-btn"); await hp.click('#loveWin [data-v="5"]');
ok((await love()) === "5,Practice these 5,1–5 of 11,1", "hard words: Show 5 starts again at page 1 with 5 words", await love());
await hp.click("#loveWin .dd-btn"); await hp.click('#loveWin [data-v="all"]');
ok((await love()) === "11,Practice these 11,,-" && !(await vis(hp, "#lovePager")), "hard words: Show All lists every word on one page", await love());
{ const edge = await hp.evaluate(() => Math.round(document.querySelector("#loveWin").getBoundingClientRect().left - document.querySelector("#hLove").getBoundingClientRect().left));
  ok(edge === 0, "hard words: with no pages to flip through, the per-page choice lines up with the list's edge", `${edge}px`); }
const firstLine = () => hp.$eval("#hLove > li .pair > :first-child", (e) => e.className);
ok((await firstLine()) === "jp", "hard words: Japanese first by default", await firstLine());
await hp.click('#loveTopSeg [data-top="en"]');
ok((await firstLine()) === "en" && (await hp.$eval('#histSetTop [data-top="en"]', (b) => b.getAttribute("aria-pressed"))) === "true", "hard words: English first, and Settings shows the same choice", await firstLine());
await hp.click("#hPractise"); await hp.waitForTimeout(300);
ok(await vis(hp, "#quiz") && /^0 of 11 done/.test(await text(hp, "#progLbl")), "hard words: Practice these practices the words shown", await text(hp, "#progLbl"));
ok(hp.errors.length === 0, "history pages: no page errors", hp.errors.join(" | "));
await hctx.close();
// Extra tools: a view of the page with the menu beside it; the romaji sheet has 9 panels of all 46 romaji, New sheet shuffles
// them, and Download PDF saves a PDF. The old study-tools/ address opens it.
const stctx = await browser.newContext({ acceptDownloads: true });
const stp = await newPage(stctx, { width: 1280, init: () => localStorage.setItem("qcard:welcomed", "1") });
await stp.click('#sideNav [data-go="tools"]'); await stp.waitForTimeout(500);
ok(await vis(stp, "#tools") && await stp.locator("#sideNav").isVisible() && await stp.$eval('#sideNav [data-go="tools"]', (b) => b.getAttribute("aria-current")) === "page" && await stp.locator("#romaji-sheet").isVisible(),
  "extra tools: opens in the page, the menu beside it and Extra tools marked");
await stp.goto(base + "study-tools/"); await stp.waitForTimeout(800);
ok(await vis(stp, "#tools") && await stp.locator("#romaji-sheet").isVisible(), "extra tools: the old study-tools/ address opens it", stp.url());
const stOrder = () => stp.$$eval(".preview text", (t) => t.map((x) => x.textContent));
const st1 = await stOrder(); await stp.click("[data-new]"); const st2 = await stOrder();
ok(st1.length === 414 && new Set(st1.slice(0, 46)).size === 46 && st1.join() !== st2.join(), "study tools: 9 panels of the 46 romaji, shuffled again by New sheet", `${st1.length}`);
const [stdl] = await Promise.all([stp.waitForEvent("download"), stp.click("[data-pdf]")]);
const stpdf = (await import("node:fs")).readFileSync(await stdl.path(), "latin1");
ok(/^romaji-sheet-.*\.pdf$/.test(stdl.suggestedFilename()) && stpdf.startsWith("%PDF") && (stpdf.match(/\) Tj/g) || []).length === 414, "study tools: Download PDF saves the sheet shown as a PDF", stdl.suggestedFilename());
// Each part has its own address, so the browser's back button steps back through them, and an address opens its part.
await stp.goto(base); await stp.waitForTimeout(800);
await stp.click('#sideNav [data-go="table"]'); await stp.waitForTimeout(300);
await stp.click('#sideNav [data-go="history"]'); await stp.waitForTimeout(300);
const atProg = new URL(stp.url()).hash;
await stp.goBack(); await stp.waitForTimeout(400);
const backTo = [new URL(stp.url()).hash, await vis(stp, "#table")];
await stp.goBack(); await stp.waitForTimeout(400);
ok(atProg === "#progress" && backTo[0] === "#vocabulary" && backTo[1] && new URL(stp.url()).hash === "" && await vis(stp, "#setup"),
  "addresses: each part has its own, and back steps through them", `${atProg} ${backTo} ${stp.url()}`);
await stp.goto(base + "#progress"); await stp.waitForTimeout(800);
ok(await vis(stp, "#history") && await stp.$eval('#sideNav [data-go="history"]', (b) => b.getAttribute("aria-current")) === "page", "addresses: #progress opens Progress");
ok(stp.errors.length === 0, "study tools: no page errors", stp.errors.join(" | "));
await stctx.close();
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
const signOut = async () => { await settings(ap, "account"); await ap.click("#signOutBtn"); await ap.waitForTimeout(800); };
const signIn = async (u) => { await ap.evaluate((u) => { window.__nextUser = u; }, u); await settings(ap, "account"); await ap.click("#signOutBtn"); await ap.waitForTimeout(1200); };
await settings(ap);
ok(/^On since/.test(await text(ap, "#shareInfo")), "share, another account: (the first account shares its handwriting)", await text(ap, "#shareInfo"));
await ap.click("#settingsClose");
await signOut(); await signIn({ uid: "b1", displayName: "B", email: "b@example.com" });
await settings(ap);
ok(/b@example\.com/.test(await text(ap, "#acctName")) && /Change your mind at any time/.test(await text(ap, "#shareInfo")), "share, another account: an account that never said yes isn't sharing", await text(ap, "#shareInfo"));
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
await settings(ap);
ok(/c@example\.com/.test(await text(ap, "#acctName")) && /Change your mind at any time/.test(await text(ap, "#shareInfo")) && !(await fsData(ap))["users/c1/data/prefs"]?.share,
  "share, another account: a first sign-in doesn't take this browser's yes along", await text(ap, "#shareInfo"));
ok(ap.errors.length === 0, "another account: no page errors", ap.errors.join(" | "));

// ---------- 18. the page people give to their AI assistant, and llms.txt ----------
// AI tools usually fetch a page without running scripts, so everything is in its HTML; its scripts only add the colours and buttons.
const aipctx = await browser.newContext({ javaScriptEnabled: false });
const aip = await aipctx.newPage(); await aip.setViewportSize({ width: 375, height: 900 });
const aiErrors = []; aip.on("console", (m) => { if (m.type() === "error") aiErrors.push(m.text()); });
await aip.goto(base + "ai/"); await aip.waitForTimeout(300);
const aiHtml = await (await fetch(base + "ai/")).text();
ok([...aiHtml.matchAll(/<script[^>]*>/gi)].map((m) => m[0]).join() === '<script src="../js/pages.js">,<script src="../js/ai.js" defer>' && /For AI assistants/.test(aiHtml) && /"app": "jp-vocab-practice"/.test(aiHtml)
  && /collect all the material/i.test(aiHtml) && /overview table/.test(aiHtml) && /only once they say it's right/.test(aiHtml),
  "AI page: only its own two scripts, and the instructions for AI assistants (collect, show the sets as tables, then the file) are in its HTML");
ok(await aip.evaluate(() => !document.querySelector("#for-ai").open && /Send your AI this page's link and your vocab list\. You could say:/.test(document.body.textContent)
  && document.querySelector("#askText").textContent === "Read this page and make an import file with me: https://andever2026.github.io/Q-Card/ai/"
  && !/blurry photo|textbooks publicly/.test(document.body.textContent)), "AI page: the card says what to send, with the live link; the AI part starts folded");
ok(await aip.evaluate(() => ["#copyBtn", "#aiImportBtn"].every((x) => !document.querySelector(x).getClientRects().length)) && /open Settings \(the gear\)/.test(await text(aip, ".no-js")) && await vis(aip, ".no-js"),
  "AI page without scripts: no dead buttons, it says where Import is instead");
ok((await aip.evaluate(() => document.documentElement.scrollWidth)) <= 375, "AI page: fits a phone");
await aip.screenshot({ path: join(out, "18-ai-page-phone.png"), fullPage: true });
await aip.click("#for-ai summary");
ok(await aip.evaluate(() => document.querySelector("#for-ai").open), "AI page: the AI part opens");
await aip.screenshot({ path: join(out, "18-ai-page-open.png"), fullPage: true });
ok(aiErrors.length === 0, "AI page: no errors (fonts load, nothing blocked)", aiErrors.join(" | "));
const example = await aip.evaluate(() => document.querySelector("#example").textContent);
let exampleFile = null;
try { exampleFile = JSON.parse(example); } catch {}
ok(exampleFile?.app === "jp-vocab-practice" && exampleFile.version === 2 && exampleFile.sets.length === 2, "AI page: the example is valid JSON in the import format");
const llms = await fetch(base + "llms.txt");
ok(llms.ok && /^# Japanese Vocab Practice/.test(await llms.text()), "llms.txt: served, and points AI tools to the page");
await aipctx.close();
// With scripts: the site's colours, the Copy button and the page's own Import button.
{
  const actx = await browser.newContext();
  await actx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.slice(0, -1) });
  const aiPage = async (init, width = 375) => {
    const p = await actx.newPage(); await p.setViewportSize({ width, height: 900 });
    p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
    await p.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    if (init) await p.addInitScript(init);
    await p.route("**/js/platform.js", (r) => r.fulfill({ contentType: "text/javascript", body: platformJs }));
    await p.goto(base + "ai/"); await p.waitForTimeout(300);
    return p;
  };
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  let a = await aiPage();
  ok((await bg(a)) === "rgb(253, 253, 253)" && !(await a.evaluate(() => document.documentElement.dataset.palette || document.documentElement.dataset.theme)), "AI page: Blue and the device's light or dark until Settings say otherwise", await bg(a));
  ok(await a.evaluate(() => document.querySelector("#askText").textContent) === `Read this page and make an import file with me: ${base}ai/`, "AI page: the message names this page's own link");
  await a.click("#copyBtn"); await a.waitForTimeout(100);
  ok(await a.evaluate(() => navigator.clipboard.readText()) === `Read this page and make an import file with me: ${base}ai/` && (await text(a, "#copyBtn")) === "Copied", "AI page: Copy copies the message, link included");
  await a.close();
  // Warm and dark, picked in Settings (any tab of the site), and changed again while the page is open.
  const site = await actx.newPage(); await site.goto(base + "llms.txt");
  await site.evaluate(() => { localStorage.setItem("jpq:palette", JSON.stringify("claude")); localStorage.setItem("jpq:theme", JSON.stringify("dark")); });
  a = await aiPage();
  ok(await a.evaluate(() => document.documentElement.dataset.palette === "claude" && document.documentElement.dataset.theme === "dark") && (await bg(a)) === "rgb(23, 24, 26)", "AI page: follows Warm and Dark from Settings", await bg(a));
  await a.screenshot({ path: join(out, "18-ai-page-warm-dark.png"), fullPage: true });
  await site.evaluate(() => { localStorage.setItem("jpq:palette", JSON.stringify("indigo")); localStorage.setItem("jpq:theme", JSON.stringify("light")); }); await a.waitForTimeout(200);
  ok(await a.evaluate(() => !document.documentElement.dataset.palette && document.documentElement.dataset.theme === "light") && (await bg(a)) === "rgb(253, 253, 253)", "AI page: changing them in another tab changes it too", await bg(a));
  const pv = await actx.newPage(); await pv.goto(base + "privacy/");
  ok(await pv.evaluate(() => document.documentElement.dataset.theme === "light") && (await pv.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(253, 253, 253)", "privacy page: follows Settings too");
  await site.evaluate(() => localStorage.setItem("jpq:theme", JSON.stringify("dark"))); await pv.waitForTimeout(200);
  ok((await pv.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(24, 24, 24)", "privacy page: Blue in dark");
  await pv.close();
  await site.evaluate(() => { localStorage.removeItem("jpq:theme"); localStorage.removeItem("jpq:palette"); });
  // Import on the AI page: the same preview as Settings → Import, shown in the card, and saved where the site keeps this
  // person's vocab. Nothing leaves the page, and the sign-in and database script loads only once a file is being imported.
  const exFile = join(out, "18-ai-example.json"), badFile = join(out, "18-not-vocab.json"), txtFile = join(out, "18-not-json.json");
  writeFileSync(exFile, example); writeFileSync(badFile, JSON.stringify({ hello: 1 })); writeFileSync(txtFile, "たべる, to eat");
  const pick = async (p, file, wait = 500) => { const [ch] = await Promise.all([p.waitForEvent("filechooser"), p.click("#aiImportBtn")]); await ch.setFiles(file); await p.waitForTimeout(wait); };
  const platformLoads = (p) => p.evaluate(() => document.querySelectorAll('script[src$="js/platform.js"]').length);
  const prev = (p) => text(p, "#aiImportPreview"), msg = (p) => text(p, "#aiImportMsg");
  await pick(a, badFile, 200);
  ok(/isn't a Japanese Vocab Practice file\. Ask your AI/.test(await msg(a)) && !(await vis(a, "#aiImportPreview")), "AI page Import: a file that isn't one says so", await msg(a));
  await pick(a, txtFile, 200);
  ok(/couldn't be read/.test(await msg(a)) && (await platformLoads(a)) === 0, "AI page Import: a file that isn't JSON says so, and neither loaded the sign-in script", await msg(a));
  // A first-time visitor, not signed in: it saves in this browser, as the site does for a guest.
  await pick(a, exFile);
  ok(/^18-ai-example\.json/.test(await prev(a)) && /Vocab sets: 2 new/.test(await prev(a)) && /Kanji lists: 1 new/.test(await prev(a)) && /Collection order: will change/.test(await prev(a)) && !/valid/.test(await prev(a)),
    "AI page Import: the preview shows in the card, the same as Settings → Import", await prev(a));
  ok(/\/ai\/$/.test(a.url()) && (await platformLoads(a)) === 1 && /not signed in, so this saves in this browser only/.test(await text(a, "#aiImportPreview [data-where]")) && !(await msg(a)),
    "AI page Import: it stays on the page and says where it will save", await text(a, "#aiImportPreview [data-where]"));
  ok(await a.evaluate(() => Object.keys(localStorage).every((k) => !k.startsWith("qcard:local:"))), "AI page Import: nothing is saved before Import is pressed");
  await a.screenshot({ path: join(out, "18-ai-import-preview.png"), fullPage: true });
  await a.click("#aiImportPreview #importGo"); await a.waitForTimeout(600);
  ok((await a.evaluate(() => JSON.parse(localStorage.getItem("qcard:local:sets/my-japanese-week-1-food") || "null")))?.words?.length === 5 && await a.evaluate(() => !!localStorage.getItem("qcard:local:kanji/my-japanese-week-1") && !!localStorage.getItem("qcard:local:meta/books")),
    "AI page Import: importing saves the sets, kanji list and collection order in this browser");
  ok(/^Imported: 2 new sets, 1 kanji list, collection order\.$/.test(await msg(a)) && !(await vis(a, "#aiImportPreview")) && await vis(a, "#aiImportDone") && /\/ai\/$/.test(a.url()),
    "AI page Import: it says what was imported and links to the site", await msg(a));
  await a.screenshot({ path: join(out, "18-ai-import-done.png"), fullPage: true });
  await pick(a, exFile);
  ok(/Everything in this file is already here/.test(await prev(a)) && !(await vis(a, "#aiImportDone")) && !(await a.$("#aiImportPreview [data-where]")) && (await platformLoads(a)) === 1,
    "AI page Import: the same file again has nothing new", await prev(a));
  await a.click("#aiImportPreview #importCancel");
  ok(!(await vis(a, "#aiImportPreview")), "AI page Import: Close puts the preview away");
  // The site then has them: the welcome pop-up still comes first on a first visit, and the sample sets stay out of the way.
  await Promise.all([a.waitForURL(base), a.evaluate(() => { document.querySelector("#aiImportDone").hidden = false; document.querySelector("#aiImportDone a").click(); })]);
  await a.waitForTimeout(500);
  ok(await a.evaluate(() => document.querySelector("#welcome").open && !document.querySelector("#settings").open), "AI page Import, first visit to the site: the welcome pop-up as usual, no Settings");
  await a.click("#guestBtn"); await a.waitForTimeout(600);
  ok(await vis(a, '[data-set="my-japanese-week-1-food"]') && await vis(a, '[data-set="my-japanese-week-1-weather"]') && !(await a.$('[data-set^="samples-"]')) && await a.evaluate(() => !document.querySelector("#settings").open),
    "AI page Import: the imported sets are on the site, without the sample sets");
  // Signed in on the site: it saves to the account, and says which.
  const sctx = await browser.newContext();
  const seed = await sctx.newPage(); await seed.goto(base + "llms.txt");
  await seed.evaluate(() => localStorage.setItem("fake:user", JSON.stringify({ uid: "ai1", displayName: "AI Tester", email: "ai1@example.com" })));
  const b = await sctx.newPage(); await b.setViewportSize({ width: 900, height: 900 });
  b.errors = []; b.on("pageerror", (e) => b.errors.push(e.message)); b.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) b.errors.push(m.text()); });
  await b.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  await b.route("**/js/platform.js", (r) => r.fulfill({ contentType: "text/javascript", body: platformJs }));
  await b.goto(base + "ai/"); await b.waitForTimeout(300);
  await pick(b, exFile);
  ok(/This saves to your account \(ai1@example\.com\)\./.test(await text(b, "#aiImportPreview [data-where]")) && /Vocab sets: 2 new/.test(await prev(b)), "AI page Import, signed in: it says it saves to the account", await text(b, "#aiImportPreview [data-where]"));
  await b.click("#aiImportPreview #importGo"); await b.waitForTimeout(600);
  const saved = await b.evaluate(() => JSON.parse(localStorage.getItem("fake:fs") || "{}"));
  ok(saved["users/ai1/sets/my-japanese-week-1-food"]?.words?.length === 5 && !!saved["users/ai1/kanji/my-japanese-week-1"] && Object.keys(saved).every((k) => k.startsWith("users/ai1/"))
    && await b.evaluate(() => Object.keys(localStorage).every((k) => !k.startsWith("qcard:local:"))), "AI page Import, signed in: saved in the account's own folder and nowhere else", Object.keys(saved).join(" "));
  // A changed set shows as changed, with its name.
  const changedFile = join(out, "18-ai-example-changed.json"), ex2 = JSON.parse(example);
  ex2.sets[0].words.push({ id: "w6", en: "tea", kana: "おちゃ", kanji: "お茶" }); writeFileSync(changedFile, JSON.stringify(ex2));
  await pick(b, changedFile);
  ok(/Vocab sets: 1 changed, 1 already the same/.test(await prev(b)) && /Changed: Week 1 › Food and drink/.test(await prev(b)) && /Import 1 change/.test(await prev(b)), "AI page Import: a set that differs from the stored one shows as changed", await prev(b));
  const site2 = await newPage(sctx);
  ok(await vis(site2, '[data-set="my-japanese-week-1-food"]') && !(await site2.evaluate(() => document.querySelector("#welcome").open)), "AI page Import, signed in: the sets are on the site");
  const d = await aiPage(null, 1280);
  await d.screenshot({ path: join(out, "18-ai-page-desktop.png") });
  const errs = [a, b, d, site2].flatMap((p) => p.errors), csp = (await Promise.all([a, b, d, site2].map((p) => p.evaluate(() => window.__csp)))).flat();
  ok(errs.length === 0 && csp.length === 0, "AI page with scripts: no errors and nothing blocked", [...errs, ...csp].join(" | "));
  await sctx.close();
  await actx.close();
}

// The example imports as it stands, and Settings links to the page beside Import.
const ictx = await browser.newContext();
const ip = await newPage(ictx);
await ip.click("#guestBtn"); await ip.waitForTimeout(400);
await settings(ip, "data");
ok(await ip.evaluate(() => { const a = document.querySelector("#aiHelp a"); return !!a && a.getAttribute("href") === "ai/" && a.target === "_blank"; }) && await vis(ip, "#aiHelp"), "settings: links to the AI page beside Import, in a new tab");
const exPath = join(out, "18-ai-example.json"); writeFileSync(exPath, example);
const [ichooser] = await Promise.all([ip.waitForEvent("filechooser"), ip.click("#importBtn")]);
await ichooser.setFiles(exPath); await ip.waitForTimeout(300);
ok(/Vocab sets: 2 new/.test(await text(ip, "#importPreview")) && /Kanji lists: 1 new/.test(await text(ip, "#importPreview")) && !/valid/.test(await text(ip, "#importPreview")),
  "AI page: its example imports with nothing skipped", await text(ip, "#importPreview"));
await ip.click("#importGo"); await ip.waitForTimeout(800);
const imported = await ip.evaluate(() => JSON.parse(localStorage.getItem("qcard:local:sets/my-japanese-week-1-weather") || "null"));
ok(imported?.unit === "Week 1" && imported.words.length === 4 && imported.words[0].kanji === "（お）天気", "AI page: the example's sets are saved as written");
ok(ip.errors.length === 0, "AI page import: no page errors", ip.errors.join(" | "));
await ictx.close();

// The privacy page: plain like the AI page, linked from the footer and from Settings.
{
  const pctx = await browser.newContext({ javaScriptEnabled: false });
  const pp = await pctx.newPage(); await pp.setViewportSize({ width: 375, height: 900 });
  const perr = []; pp.on("console", (m) => { if (m.type() === "error") perr.push(m.text()); });
  const pres = await pp.goto(base + "privacy/"); await pp.waitForTimeout(300);
  const phtml = await pres.text();
  ok(pres.ok() && [...phtml.matchAll(/<script[^>]*>/gi)].map((m) => m[0]).join() === '<script src="../js/pages.js">' && /<h1>Privacy Policy<\/h1>/.test(phtml) && /mailto:andever2026@gmail\.com/.test(phtml) && !/\[date/.test(phtml),
    "privacy page: served with only the colours script, a contact and a date");
  ok((await pp.evaluate(() => document.documentElement.scrollWidth)) <= 375, "privacy page: fits a phone");
  ok(perr.length === 0, "privacy page: no errors (fonts load, nothing blocked)", perr.join(" | "));
  await pp.screenshot({ path: join(out, "18-privacy-phone.png"), fullPage: true });
  await pctx.close();
  const lctx = await browser.newContext();
  const lp = await newPage(lctx);
  await lp.click("#guestBtn"); await lp.waitForTimeout(400);
  await settings(lp, "account");
  ok(!(await lp.$("#privacyLink")), "settings: no second privacy link in Account (the sidebar has it)");
  await lp.click("#settingsClose");
  await lp.click("#menuBtn"); await lp.waitForTimeout(300);
  ok(await lp.locator('#sideNav > .foot a[href="privacy/"]').isVisible() && await lp.evaluate(() => { const f = document.querySelector(".foot").getBoundingClientRect(), n = document.querySelector("#sideNav").getBoundingClientRect(); return n.bottom - f.bottom < 30 && f.left >= n.left; })
    && !(await lp.$('.foot a[href="study-tools/"]')), "footer: at the bottom of the menu that slides in, linking to the privacy page");
  await Promise.all([lp.waitForURL("**/privacy/"), lp.click('.foot a[href="privacy/"]')]);
  ok(/^Privacy Policy/.test(await lp.title()), "footer: the link opens the privacy page");
  ok(lp.errors.length === 0, "privacy links: no page errors", lp.errors.join(" | "));
  await lctx.close();
}

// ---------- 19. a downloaded copy opened straight from disk, with no internet ----------
// The data files come as scripts (js/templates.js, js/samples.js), which a page opened from disk may load.
{
  const fctx = await browser.newContext();
  const outside = [];
  await fctx.route("**/*", (r) => { const u = r.request().url(); if (u.startsWith("file:") || u.startsWith("data:") || u.startsWith("blob:")) return r.continue(); outside.push(u); return r.abort("internetdisconnected"); });
  const fp = await fctx.newPage();
  await fp.setViewportSize({ width: 900, height: 1000 });
  const ferr = [];
  fp.on("pageerror", (e) => ferr.push(e.message));
  fp.on("console", (m) => { if (m.type() === "error") ferr.push(m.text()); });
  await fp.goto("file://" + join(root, "index.html")); await fp.waitForTimeout(800);
  await fp.click("#guestBtn"); await fp.waitForTimeout(800);
  ok(await vis(fp, '[data-set="samples-greetings"]'), "from disk: the page starts as a guest with the sample sets");
  await fp.click('[data-set="samples-greetings"]'); await fp.click("#dir-ej"); await fp.click("#startBtn"); await fp.waitForTimeout(300);
  const { writeWord } = await import("../checker/synth.mjs");
  const samples = JSON.parse(readFileSync(join(root, "data/samples.json"), "utf8"));
  const prompt = await text(fp, "#qText"), sw = samples.sets.flatMap((x) => x.words).find((x) => x.en === prompt);
  const kana = (sw?.kana || "").replace(/（[^）]*）/g, "").split("／")[0];
  const b = await (await fp.$("#mainPad")).boundingBox();
  const { strokes, box } = writeWord(kana || "ねこ", 5, { boxW: b.width, boxH: b.height, level: 0.3, mouse: false, swap: 0, reverse: 0, join: 0, lateDakuten: 0 });
  const k = Math.min(1, b.width / box.w, b.height / box.h);
  for (const st of strokes) {
    await fp.mouse.move(b.x + st[0][0] * k, b.y + st[0][1] * k); await fp.mouse.down();
    for (const [x, y] of st.slice(1)) await fp.mouse.move(b.x + x * k, b.y + y * k);
    await fp.mouse.up();
  }
  await fp.click("#checkBtn"); await fp.waitForTimeout(1500);
  ok(!!sw && !(await vis(fp, "#feedback")) && !(await vis(fp, "#selfCheck")), "from disk: the built-in checker accepts a right answer", `${kana}${await vis(fp, "#feedback") ? " → " + await text(fp, "#fbReason") : ""}`);
  ok(!outside.length, "from disk: nothing is fetched from the internet", outside.join(" "));
  ok(!ferr.length, "from disk: no page errors", ferr.join(" | "));
  await fctx.close();
}

// ---------- 20. the scratch pad takes a pencil's strokes whole ----------
// Pen strokes dispatched as the page sees them from an Apple Pencil: many points per stroke, and a pointerup that
// goes astray. Nothing may be dropped, and a stroke left open must not shut the box for the strokes after it.
{
  const sctx = await browser.newContext();
  const sp = await newPage(sctx);
  await sp.click("#guestBtn"); await sp.waitForTimeout(400);
  await sp.click('[data-set="samples-greetings"]'); await sp.click("#dir-je"); await sp.click("#startBtn"); await sp.waitForTimeout(300);
  await scribble(sp); await sp.click("#checkBtn"); await sp.waitForTimeout(400);
  await sp.click("#selfMiss"); await sp.waitForTimeout(400);
  ok(await vis(sp, "#scratchPad"), "scratch pad: shows after marking a word missed");
  // Draws one horizontal pen stroke across the pad at the given height, in `pts` moves; `drop` leaves the pointerup out.
  const penStroke = (id, atY, { drop = false } = {}) => sp.evaluate(([id, atY, drop]) => {
    const c = document.querySelector("#scratchPad"), r = c.getBoundingClientRect();
    const send = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "pen", isPrimary: true, buttons, pressure: buttons ? 0.5 : 0, clientX: r.left + x, clientY: r.top + y }));
    const y = r.height * atY, x0 = r.width * 0.1, x1 = r.width * 0.9;
    send("pointerdown", x0, y, 1);
    for (let i = 1; i <= 40; i++) send("pointermove", x0 + ((x1 - x0) * i) / 40, y, 1);
    if (!drop) send("pointerup", x1, y, 0);
    return { x0, x1 };
  }, [id, atY, drop]);
  // Ink in a horizontal band of the pad: how many pixels, and how far across they run.
  const ink = (atY) => sp.evaluate((atY) => {
    const c = document.querySelector("#scratchPad"), d = window.devicePixelRatio || 1;
    const y = Math.round(c.height * atY), h = Math.round(12 * d);
    const px = c.getContext("2d").getImageData(0, Math.max(0, y - h), c.width, h * 2).data;
    let n = 0, x0 = c.width, x1 = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 10) { const x = ((i - 3) / 4) % c.width; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    return { n, span: (x1 - x0) / c.width };
  }, atY);
  const one = await penStroke(7, 0.25);
  const firstInk = await ink(0.25);
  ok(firstInk.n > 0 && firstInk.span > 0.7, "scratch pad: a pencil stroke is drawn the whole way across", JSON.stringify(firstInk));
  await penStroke(8, 0.5, { drop: true }); // this one's pointerup never arrives
  await penStroke(9, 0.75);
  const afterInk = await ink(0.75);
  ok(afterInk.n > 0 && afterInk.span > 0.7, "scratch pad: a stroke whose pointerup is lost doesn't stop the next one", JSON.stringify(afterInk));
  // iPadOS gives the pencil the same id every time, and an eraser drag can lose its pointerup too.
  await sp.click("#scratchClear"); await sp.waitForTimeout(150);
  await penStroke(5, 0.25, { drop: true }); await penStroke(5, 0.5);
  const sameId = await ink(0.5);
  await sp.click('#feedback [data-tool="erase"]'); await penStroke(6, 0.25, { drop: true }); await sp.click('#feedback [data-tool="pen"]');
  await penStroke(6, 0.75);
  const afterErase = await ink(0.75);
  ok(sameId.n > 0 && sameId.span > 0.7 && afterErase.n > 0 && afterErase.span > 0.7,
    "scratch pad: a lost pointerup with the pencil's same id, or after an eraser drag, doesn't stop the next stroke", JSON.stringify({ sameId, afterErase }));
  await sp.click("#scratchClear"); await sp.waitForTimeout(150);
  await penStroke(7, 0.25); await penStroke(9, 0.75);
  await sp.click("#scratchUndo"); await sp.waitForTimeout(150);
  ok((await ink(0.75)).n === 0 && (await ink(0.25)).n > 0, "scratch pad: Undo removes the last stroke and keeps the rest");
  await sp.click("#scratchClear"); await sp.waitForTimeout(150);
  ok((await ink(0.25)).n === 0, "scratch pad: Clear empties it");
  ok(sp.errors.length === 0, "scratch pad: no page errors", sp.errors.join(" | "));
  await sp.screenshot({ path: join(out, "20-scratch-pad.png") });
  await sctx.close();
}

// ---------- 21. furigana over the kanji written: すいぞく over 水族かん, おととし over 一昨年 (a reading of the whole word) ----------
if (entry.length > 1) {
  const { writeWord } = await import("../checker/synth.mjs");
  const fctx = await browser.newContext();
  const fp = await newPage(fctx, { init: () => {
    if (localStorage.getItem("qcard:mode")) return;
    const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
    localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
    put("sets/f-a", { collection: "F", unit: "U", name: "A", words: [{ id: "1", en: "aquarium", kana: "すいぞくかん", kanji: "水族館" }, { id: "2", en: "year before last", kana: "おととし", kanji: "一昨年" }] });
    put("data/users/local/settings", { history: true });
    localStorage.setItem("jpq:selected", '["f-a"]'); localStorage.setItem("jpq:dir", '"ej"');
  } });
  // each character written on its own, spread out the way people write furigana over the kanji they belong to
  const writeAt = async (sel, parts, seed) => {
    const b = await (await fp.$(sel)).boundingBox();
    for (const [str, fx] of parts) {
      const { strokes, box } = writeWord(str, seed++, { boxW: b.height, boxH: b.height, level: 0.3, mouse: false, swap: 0, reverse: 0, join: 0, lateDakuten: 0 });
      const k = (b.height / Math.max(box.w, box.h)) * 0.8, x0 = Math.min(...strokes.flat().map(([x]) => x));
      for (const st of strokes) {
        await fp.mouse.move(b.x + b.width * fx + (st[0][0] - x0) * k, b.y + st[0][1] * k); await fp.mouse.down();
        for (const [x, y] of st.slice(1)) await fp.mouse.move(b.x + b.width * fx + (x - x0) * k, b.y + y * k);
        await fp.mouse.up();
      }
    }
  };
  const answers = {
    aquarium: [[["か", 0.47], ["ん", 0.52]], [["水", 0.3], ["族", 0.4], ["か", 0.52], ["ん", 0.62]]], // かん over the kana: wrong
    aquarium2: [[["す", 0.3], ["い", 0.35], ["ぞ", 0.42], ["く", 0.47]], [["水", 0.3], ["族", 0.4], ["か", 0.52], ["ん", 0.62]]],
    "year before last": [[["お", 0.3], ["と", 0.42], ["と", 0.47], ["し", 0.58]], [["一", 0.3], ["昨", 0.4], ["年", 0.54]]],
  };
  const got = {};
  await fp.click("#startBtn"); await fp.waitForTimeout(300);
  for (let i = 0; i < 6 && await vis(fp, "#quiz"); i++) {
    const q = await text(fp, "#qText"), key = q === "aquarium" && got.aquarium ? "aquarium2" : q;
    await writeAt("#furiPad", answers[key][0], 3); await writeAt("#mainPad", answers[key][1], 9);
    await fp.click("#checkBtn"); await fp.waitForTimeout(800);
    got[key] = await vis(fp, "#feedback") ? await text(fp, "#fbReason") : "ok";
    if (await vis(fp, "#feedback")) await fp.click("#nextBtn");
    await fp.waitForTimeout(1300);
  }
  ok(got.aquarium === "The furigana doesn't match the reading of this word.", "furigana: かん over the かん of 水族かん fails", got.aquarium);
  ok(got.aquarium2 === "ok", "furigana: すいぞく over 水族 in 水族かん passes", got.aquarium2);
  ok(got["year before last"] === "ok", "furigana: おととし over 一昨年, a reading of the whole word, passes", got["year before last"]);
  // the words that need more love show their reading over the kanji, on the results and in History
  const loveRuby = (sel) => fp.evaluate((q) => [...document.querySelectorAll(q + " li ruby")].map((r) => r.firstChild.textContent + "/" + r.querySelector("rt").textContent).join(","), sel);
  ok(await vis(fp, "#results") && (await loveRuby("#loveList")) === "水族館/すいぞくかん", "results: a word that needs more love has its reading over the kanji", await loveRuby("#loveList"));
  await fp.screenshot({ path: join(out, "21-results-furigana.png") });
  await fp.click("#newBtn"); await fp.waitForTimeout(300); await goView(fp, "history");
  ok((await loveRuby("#hLove")) === "水族館/すいぞくかん", "history: the hard words have their reading over the kanji", await loveRuby("#hLove"));
  await fp.screenshot({ path: join(out, "21-history-furigana.png") });
  ok(fp.errors.length === 0, "furigana: no page errors", fp.errors.join(" | "));
  await fctx.close();
}

// ---------- 22. the menu on a big screen: a sidebar, with Settings' tabs under Settings ----------
{
  const bctx = await browser.newContext();
  const bp = await newPage(bctx, { width: 1280, init: () => {
    if (localStorage.getItem("qcard:mode")) return;
    const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
    localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
    put("sets/b-a", { collection: "B", unit: "Week 1", name: "Two", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }, { id: "b", en: "tea", kana: "おちゃ", kanji: "お茶" }] });
  } });
  await bp.waitForTimeout(400);
  const shown = (sel) => bp.evaluate((s) => document.querySelector(s)?.getClientRects().length > 0, sel);
  const at = () => bp.evaluate(() => [...document.querySelectorAll("#sideNav [aria-current], #settingsBtn[aria-current]")].map((b) => b.dataset.go || b.id).join(","));
  const sideInfo = () => bp.evaluate(() => { const h = document.querySelector("header.side").getBoundingClientRect(), v = [...document.querySelectorAll("section")].find((s) => !s.hidden).getBoundingClientRect();
    return { fixed: getComputedStyle(document.querySelector("header.side")).position === "fixed", side: [Math.round(h.left), Math.round(h.width)], col: Math.round(v.left), wide: document.documentElement.scrollWidth }; });
  let si = await sideInfo();
  const barBtn = () => bp.evaluate(() => { const m = document.querySelector("#menuBtn").getBoundingClientRect(), h = document.querySelector("header h1").getBoundingClientRect(); return m.bottom <= h.bottom && m.right < h.left + 70 && m.left < 40; });
  ok(si.fixed && si.side[0] === 0 && si.side[1] === 232 && si.col > 232 && si.wide <= 1280 && (await at()) === "setup" && await barBtn() && (await bp.getAttribute("#menuBtn", "aria-expanded")) === "true",
    "sidebar: on a big screen the menu is a sidebar down the left under the title's bar, Practice marked, the page beside it, ☰ left of the title", JSON.stringify(si));
  const topR = () => bp.evaluate(() => { const g = document.querySelector("#settingsBtn").getBoundingClientRect(), a = document.querySelector("#acctBtn").getBoundingClientRect();
    return { right: Math.round(document.querySelector("header h1").getBoundingClientRect().right - g.right), inBar: g.bottom <= 56 && a.bottom <= 56, order: a.right <= g.left, label: document.querySelector("#acctLabel").textContent }; });
  const tr = await topR();
  ok(tr.inBar && tr.order && tr.right >= 8 && tr.right <= 24 && tr.label === "Guest" && !(await shown("#sideNav #settingsBtn")), "top bar: Guest and then the gear at its right end, nothing for Settings in the sidebar", JSON.stringify(tr));
  await bp.click("#acctBtn");
  ok(/Sign in to sync between devices/.test(await text(bp, "#acctList")) && (await bp.$$eval("#acctList [role=menuitem]", (bs) => bs.map((b) => b.textContent.trim()).join(", "))) === "Sign in with Google", "account menu: a guest's offers signing in");
  await bp.screenshot({ path: join(out, "22-guest-menu.png"), clip: { x: 640, y: 0, width: 640, height: 220 } });
  await bp.keyboard.press("Escape");
  await bp.screenshot({ path: join(out, "22-sidebar.png") });
  const footAt = () => bp.evaluate(() => { const f = document.querySelector(".foot"), r = f.getBoundingClientRect(); return { inSide: f.parentElement.matches("header.side"), shown: r.height > 0, gap: Math.round(innerHeight - r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; });
  let ft = await footAt();
  ok(ft.inSide && ft.shown && ft.gap >= 0 && ft.gap < 30 && ft.left >= 0 && ft.right <= 232, "footer: at the bottom of the sidebar", JSON.stringify(ft));
  await bp.click('#sideNav [data-go="history"]'); await bp.waitForTimeout(300);
  ok(await vis(bp, "#history") && (await at()) === "history" && !(await shown("#histBack")), "sidebar: History opens from it and is marked; no ← Back beside the sidebar");
  await bp.click('#sideNav [data-go="table"]'); await bp.waitForTimeout(300);
  const bset = '[data-sid="b-a"]', ben = `${bset} tr:first-child textarea[data-f="en"]`, bsaved = () => bp.evaluate(() => JSON.parse(localStorage.getItem("qcard:local:sets/b-a")).words[0].en);
  ok(await vis(bp, "#table") && (await at()) === "table" && !(await shown("#backBtn")), "sidebar: the vocab table opens from it");
  if (!(await vis(bp, `${bset} [data-edit]`))) await bp.click(`${bset} [data-toggle]`);
  await bp.click(`${bset} [data-edit]`); await bp.fill(ben, "cold water");
  await bp.click('#sideNav [data-go="history"]'); await bp.waitForTimeout(200);
  ok(await vis(bp, "#table") && /^1 set has unsaved changes\./.test(await text(bp, "#leaveAsk")), "sidebar: leaving the vocab table with unsaved changes asks first", await text(bp, "#leaveAsk"));
  await bp.click("#leaveAsk [data-lsave]"); await bp.waitForTimeout(400);
  ok(await vis(bp, "#history") && (await bsaved()) === "cold water", "sidebar: Save all saves, then goes where was clicked", await bsaved());
  await bp.click('#sideNav [data-go="table"]'); await bp.waitForTimeout(300);
  await bp.click(`${bset} [data-edit]`); await bp.fill(ben, "hot water");
  await bp.click("#settingsBtn"); await bp.waitForTimeout(200);
  ok(await vis(bp, "#leaveAsk"), "sidebar: Settings asks about unsaved changes too");
  await bp.click("#leaveAsk [data-ldiscard]"); await bp.waitForTimeout(300);
  ok(await setOpen(bp) && (await bsaved()) === "cold water" && (await at()) === "settingsBtn", "sidebar: Discard all saves nothing and opens Settings", await bsaved());
  const setInfo = () => bp.evaluate(() => ({ inSide: !!document.querySelector("#setNavSlot > #setNav") && document.querySelector("#setNavSlot").getClientRects().length > 0, tabs: [...document.querySelectorAll("#setNav [data-set-tab]")].filter((b) => b.getClientRects().length).map((b) => b.textContent).join(", "),
    on: document.querySelector('#setNav [aria-current="page"]')?.dataset.setTab, body: Math.round(document.querySelector(".setbody").getBoundingClientRect().width), panel: Math.round(document.querySelector(".setpage").getBoundingClientRect().width), full: Math.round(document.querySelector(".wrap").getBoundingClientRect().width) }));
  let st = await setInfo();
  // On Settings its tabs take the sidebar (as on YouTube), and ☰ brings the menu in over the page.
  const drawerOpen = () => bp.evaluate(() => { const n = document.querySelector("#sideNav"), r = n.getBoundingClientRect(); return getComputedStyle(n).position === "fixed" && getComputedStyle(n).visibility === "visible" && r.left >= 0 && getComputedStyle(document.querySelector("#sideShade")).opacity === "1"; });
  ok(st.inSide && st.tabs === "Appearance, Account, Data, Developer tools" && st.on === "look" && st.body >= st.panel - 2 && st.panel >= st.full - 2 && st.full > 900 && !(await drawerOpen()) && await shown("#settingsBtn"),
    "sidebar: on Settings its tabs take the sidebar, the page and its menu out of the way, and the tab spans the page like the others do", JSON.stringify(st));
  ft = await footAt();
  ok(ft.inSide && ft.shown && ft.gap >= 0 && ft.gap < 30, "footer: on Settings, at the bottom of the sidebar under its tabs", JSON.stringify(ft));
  await bp.click('#setNav [data-set-tab="data"]');
  ok((await setInfo()).on === "data" && await vis(bp, "#portPanel"), "sidebar: a tab in the sidebar opens it");
  await bp.screenshot({ path: join(out, "22-sidebar-settings.png") });
  await bp.click("#menuBtn"); await bp.waitForTimeout(300);
  ok(await drawerOpen() && (await bp.getAttribute("#menuBtn", "aria-expanded")) === "true" && await bp.evaluate(() => document.activeElement?.dataset.go === "setup"), "sidebar: on Settings, ☰ brings the menu in over the page");
  await bp.screenshot({ path: join(out, "22-sidebar-settings-menu.png") });
  ok(await bp.evaluate(() => getComputedStyle(document.querySelector("#sideNav")).backgroundColor === getComputedStyle(document.querySelector("header.side")).backgroundColor), "sidebar: the menu over the page looks like the sidebar");
  await bp.click("#menuBtn"); await bp.waitForTimeout(300);
  ok(!(await drawerOpen()) && await setOpen(bp), "sidebar: ☰ again puts it away");
  await bp.click("#menuBtn"); await bp.waitForTimeout(300); await bp.keyboard.press("Escape"); await bp.waitForTimeout(300);
  ok(!(await drawerOpen()) && await setOpen(bp), "sidebar: Escape puts it away too");
  await bp.click("#menuBtn"); await bp.waitForTimeout(300); await bp.click('#sideNav [data-go="setup"]'); await bp.waitForTimeout(300);
  si = await sideInfo();
  ok(await vis(bp, "#setup") && (await at()) === "setup" && si.side[1] === 232 && !(await drawerOpen()) && await shown('#sideNav [data-go="history"]') && !(await shown("#setNav")), "sidebar: Practice from it leaves Settings, and the sidebar is the menu again", JSON.stringify(si));
  await bp.click('[data-set="b-a"]'); await bp.click("#startBtn"); await bp.waitForTimeout(300);
  ok(!(await shown("header h1")) && !(await shown("#sideNav")) && (await bp.evaluate(() => getComputedStyle(document.body).paddingLeft)) === "16px", "sidebar: steps aside while writing, and practice gets the whole width");
  await bp.click("#quitBtn"); await bp.waitForTimeout(200);
  ok((await sideInfo()).fixed && await vis(bp, "#sideNav"), "sidebar: back after quitting");
  // ☰ shrinks it to its icons, on this device, until ☰ again.
  const names = () => bp.evaluate(() => [...document.querySelectorAll("#sideNav [data-go], #nbBtn")].map((b) => `${b.title}:${Math.round(b.querySelector("span").getBoundingClientRect().width)}`).join(","));
  await bp.click("#menuBtn"); await bp.waitForTimeout(200);
  si = await sideInfo();
  ok(si.side[1] === 64 && si.col < 100 && !(await footAt()).shown && (await names()) === "My notebook:0,Practice:0,Vocabulary:0,Progress:0,Extra tools:0" && (await bp.getAttribute("#menuBtn", "aria-expanded")) === "false" && await barBtn(),
    "sidebar: ☰ shrinks it to icons, named when pointed at, and the page takes the room", JSON.stringify(si) + " " + await names());
  await bp.screenshot({ path: join(out, "22-sidebar-icons.png") });
  await bp.click('#sideNav [data-go="history"]'); await bp.waitForTimeout(300);
  ok(await vis(bp, "#history") && (await at()) === "history", "sidebar: an icon still goes to its page");
  await bp.click("#settingsBtn"); await bp.waitForTimeout(300);
  ok(await setOpen(bp) && (await sideInfo()).side[1] === 232 && await shown("#setNav [data-set-tab]"), "sidebar: on Settings its tabs take the sidebar at full width, shrunk or not");
  await bp.goBack(); await bp.waitForTimeout(300); await bp.reload(); await bp.waitForTimeout(600); // reloading on Progress (on Settings, Settings opens again)
  ok((await sideInfo()).side[1] === 64 && (await at()) === "history", "sidebar: still shrunk after reloading, on the same page");
  await bp.click("#menuBtn"); await bp.waitForTimeout(200);
  ok((await sideInfo()).side[1] === 232 && (await names()).split(",").every((x) => x.startsWith(":") && +x.slice(1) > 20), "sidebar: ☰ again brings the names back", await names());
  await bp.setViewportSize({ width: 900, height: 1000 }); await bp.click("#settingsBtn"); await bp.waitForTimeout(200);
  ok(!(await sideInfo()).fixed && await vis(bp, "#menuBtn") && await bp.evaluate(() => !!document.querySelector("#settings .setpage > #setNav")), "sidebar: a narrower window has ☰ again, and Settings' tabs go back beside the tab");
  ok(bp.errors.length === 0, "sidebar: no page errors", bp.errors.join(" | "));
  await bctx.close();
}

// ---------- 23. Edit collections: views, dragging units and collections, merging, the main view, saving, export / import ----------
{
  const cctx = await browser.newContext();
  const cp = await newPage(cctx, { width: 1280, init: () => {
    if (localStorage.getItem("qcard:mode")) return;
    const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v)), w = [{ id: "w1", en: "water", kana: "みず", kanji: "水" }];
    localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
    for (let i = 1; i <= 12; i++) put(`sets/a${i}`, { collection: "Book A", unit: `Ch. ${i}`, name: "Words", words: w });
    for (let i = 1; i <= 11; i++) put(`sets/b${i}`, { collection: "Book B", unit: `Ch. ${i}`, name: "Words", words: w });
    put("kanji/ka1", { collection: "Book A", unit: "Ch. 1", kanji: "水火" }); put("kanji/kb1", { collection: "Book B", unit: "Ch. 1", kanji: "火木" });
    put("meta/books", { order: ["Book A", "Book B"] });
    put("meta/courses", { courses: [{ name: "Year 1", parts: [{ collection: "Book A", from: "Ch. 1", to: "Ch. 8" }] },
      { name: "Year 2", parts: [{ collection: "Book A", from: "Ch. 9", to: "Ch. 12" }, { collection: "Book B", from: "Ch. 1", to: "Ch. 4" }] },
      { name: "Book B\nExtras", parts: [{ collection: "Book B", from: "Ch. 9", to: "Ch. 11" }] }] });
    localStorage.setItem("jpq:groupBy", JSON.stringify("course"));
  } });
  const chs = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `Ch. ${a + i}`).join(",");
  const tRows = (p = cp) => p.$$eval("#tChs .pchrow", (rs) => rs.map((r) => `${r.querySelector(".chbook")?.textContent ?? ""}: ${[...r.querySelectorAll(".chip:not([data-k=all])")].map((c) => c.textContent).join(",")}`).join(" | "));
  const switchOf = (p = cp) => p.$$eval("#tGroupSeg [data-view]", (bs) => bs.map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join(","));
  const edRows = () => cp.$$eval("#colEd .colrow", (rs) => rs.map((r) => { const n = r.querySelector(".colname"); return `${n.value ?? n.textContent}: ${[...r.querySelectorAll(".chip.unit")].map((c) => c.textContent).join(",")}`; }).join(" | "));
  const row = (i) => cp.locator("#colEd .colrow").nth(i);
  const unit = (i, name) => row(i).locator(".chip.unit", { hasText: new RegExp(`^${name.replace(".", "\\.")}$`) });
  const drag = async (from, to, { hold } = {}) => {
    const a = await from.boundingBox(), b = await to.boundingBox(), x = a.x + a.width / 2, y = a.y + a.height / 2;
    await cp.mouse.move(x, y); await cp.mouse.down(); await cp.mouse.move(x + 20, y + 4, { steps: 3 });
    await cp.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); if (hold) await hold();
    await cp.mouse.up(); await cp.waitForTimeout(200);
  };
  const drop = (i) => row(i).locator("[data-drop]");
  const asking = () => cp.$eval("#askDlg", (d) => d.open);
  const setsNow = () => cp.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("qcard:local:sets/")).map((k) => { const d = JSON.parse(localStorage.getItem(k)); return [k.slice(17), `${d.collection}|${d.unit}|${d.name}`]; })));
  const stored = (p, page = cp) => page.evaluate((p) => JSON.parse(localStorage.getItem("qcard:local:" + p) || "null"), p);
  const strip = (d) => d && JSON.parse(JSON.stringify({ ...d, updatedAt: undefined }));

  await cp.click('#sideNav [data-go="table"]'); await cp.waitForTimeout(300);
  ok((await switchOf()) === "Books,Courses*" && (await tRows()) === `Year 1: ${chs(1, 8)} | Year 2: ${chs(9, 12)},${chs(1, 4)} | Book B\nExtras: ${chs(9, 11)}`
    && !(await cp.$("#tChs .chip .n")), "collections: older courses show as the view Courses (units in none of its collections are hidden there)", await tRows());
  const headH = () => cp.$eval("#tTop > .head", (h) => Math.round(h.getBoundingClientRect().height)), h0 = await headH();
  await cp.click("#editColBtn"); await cp.waitForTimeout(200);
  ok((await headH()) === h0, "collections: Save and Discard take the button's place without making the heading taller", `${h0} → ${await headH()}`);
  ok(await vis(cp, "#colBtns") && !(await vis(cp, "#editColBtn")) && !(await vis(cp, "#tGroupSeg")) && !(await vis(cp, "#tPickBar")) && await cp.$eval("#tSearch", (i) => i.disabled) && await cp.$eval("#colSave", (b) => b.disabled)
    && await cp.$eval("#setTables", (e) => e.inert && e.classList.contains("tlocked") && e.dataset.lock === "Editing collections") && await cp.$eval("#tTop", (e) => e.classList.contains("editing"))
    && (await cp.$$eval("#viewEd [data-view]", (bs) => bs.map((b) => b.textContent).join(","))) === "Books,Courses" && /⬑ main view/.test(await text(cp, "#viewEd .mainptr"))
    && (await edRows()) === `Book A: ${chs(1, 12)} | Book B: ${chs(1, 11)}`,
    "collections: Edit collections shows the main view's collections, Save and Discard take the button's place, and the sets below are covered", await edRows());
  await cp.hover("#viewEd .mainptr .qtip");
  ok(await vis(cp, "#mainTip") && /main view's collections/.test(await text(cp, "#mainTip")), "collections: the (?) beside the main view explains it", await text(cp, "#mainTip"));
  await cp.screenshot({ path: join(out, "23-collections.png"), fullPage: true });
  // Views are dragged into any order, the main view too.
  const vOrder = () => cp.$$eval("#viewEd [data-view]", (bs) => bs.map((b) => b.textContent).join(","));
  await cp.mouse.move(5, 500); await cp.waitForTimeout(300); // the (?) tip above lets go of the view chips
  { const vb = (n) => cp.locator("#viewEd [data-view]", { hasText: n });
    const a = await vb("Books").boundingBox(), b = await vb("Courses").boundingBox();
    await cp.mouse.move(a.x + 5, a.y + a.height / 2); await cp.mouse.down(); await cp.mouse.move(a.x + 25, a.y + a.height / 2, { steps: 3 });
    await cp.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 8 }); await cp.mouse.up(); await cp.waitForTimeout(200);
    ok((await vOrder()) === "Courses,Books" && /main view/.test(await text(cp, "#viewEd .mainptr")) && !(await cp.$eval("#colSave", (x) => x.disabled)), "collections: the main view dragged after another view moves there", await vOrder());
    const c = await vb("Courses").boundingBox(), d = await vb("Books").boundingBox();
    await cp.mouse.move(c.x + 5, c.y + c.height / 2); await cp.mouse.down(); await cp.mouse.move(c.x + 25, c.y + c.height / 2, { steps: 3 });
    await cp.mouse.move(d.x + d.width - 4, d.y + d.height / 2, { steps: 8 }); await cp.mouse.up(); await cp.waitForTimeout(200);
    ok((await vOrder()) === "Books,Courses" && await cp.$eval("#colSave", (x) => x.disabled), "collections: and back again, with nothing left to save", await vOrder()); }
  // In the main view a unit moves with its sets; one landing where a unit has its name merges with it, after asking.
  await drag(unit(0, "Ch. 12"), drop(1));
  ok((await edRows()) === `Book A: ${chs(1, 11)} | Book B: ${chs(1, 12)}` && !(await cp.$eval("#colSave", (b) => b.disabled)) && (await text(cp, "#colState")) === "Unsaved changes",
    "collections: a unit dragged to another collection goes there, in order by name, and Save lights up", await edRows());
  let shown = false;
  await drag(unit(1, "Ch. 1"), drop(0), { hold: async () => { shown = await cp.$eval("#colEd .colrow:nth-child(1) [data-drop]", (e) => e.classList.contains("dropon")); } });
  ok(shown && await asking() && (await text(cp, "#askTitle")) === "Merge these units?" && /Book A already has a unit called Ch\. 1/.test(await text(cp, "#askText")),
    "collections: the collection under a dragged unit lights up, and a unit with the same name there is asked about first", await text(cp, "#askText"));
  await cp.keyboard.press("Escape"); await cp.waitForTimeout(150);
  ok(!(await asking()) && (await edRows()) === `Book A: ${chs(1, 11)} | Book B: ${chs(1, 12)}`, "collections: Escape (or Cancel) leaves both units where they were");
  await unit(1, "Ch. 1").focus(); await cp.keyboard.press("ArrowUp"); await cp.waitForTimeout(150);
  ok(await asking(), "collections: the up arrow moves a unit to the collection above, asking the same");
  await cp.click("#askYes"); await cp.waitForTimeout(150);
  ok((await edRows()) === `Book A: ${chs(1, 11)} | Book B: ${chs(2, 12)}` && await cp.evaluate(() => document.activeElement?.matches("#colEd .colrow:nth-child(1) .chip.unit")),
    "collections: Merge them makes the two one unit", await edRows());
  // Collections: add, ↑/↓, dragged by ⠿, deleted when empty.
  await cp.click("#colEd [data-cadd]"); await cp.waitForTimeout(100);
  ok(await cp.evaluate(() => document.activeElement.matches("#colEd .colrow:nth-child(3) [data-cname]")), "collections: Add collection puts the cursor in its name");
  await cp.keyboard.type("Book C");
  await row(2).locator('[data-cmove="-1"]').click(); await cp.waitForTimeout(100);
  ok(/^Book A: .* \| Book C: +\| Book B: /.test(await edRows()) && await cp.evaluate(() => document.activeElement.matches('#colEd .colrow:nth-child(2) [data-cmove="-1"]')), "collections: ↑ moves a collection up, keeping the focus on it", await edRows());
  { const g = await row(1).locator(".grip").boundingBox(), last = await row(2).boundingBox();
    await cp.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await cp.mouse.down(); await cp.mouse.move(g.x + 8, g.y + 20, { steps: 3 });
    await cp.mouse.move(g.x + g.width / 2, last.y + last.height - 4, { steps: 8 });
    const marked = await cp.$$eval("#colEd .colrow:nth-child(3).dropbelow", (x) => x.length); await cp.mouse.up(); await cp.waitForTimeout(150);
    ok(marked === 1 && /^Book A: .* \| Book B: .* \| Book C:/.test(await edRows()), "collections: one dragged by its ⠿ goes where it's let go, a line showing where", await edRows()); }
  await drag(unit(1, "Ch. 11"), drop(2));
  ok(await row(2).locator("[data-cdel]").isDisabled() && /Book C: Ch\. 11$/.test(await edRows()), "collections: a collection with units can't be deleted in the main view", await edRows());
  await cp.click("#colEd [data-cadd]"); await row(3).locator("[data-cdel]").click(); await cp.waitForTimeout(100);
  ok((await cp.$$eval("#colEd .colrow", (r) => r.length)) === 3, "collections: an empty one can");
  // Another view: units only regroup there; units in none of its collections are in Hidden.
  await cp.click('#viewEd [data-view="0"]'); await cp.waitForTimeout(150);
  ok((await edRows()) === `Year 1: ${chs(1, 8)} | Year 2: ${chs(9, 11)},${chs(2, 4)},Ch. 12 | Book B\nExtras: ${chs(9, 11)} | Hidden: ${chs(5, 8)}`
    && !(await cp.$("#colEd .chip .n")) && await vis(cp, "#viewEd [data-vmain]"), "collections: another view follows the moves and the merge", await edRows());
  await drag(unit(3, "Ch. 5"), drop(0));
  ok(!(await asking()) && (await edRows()).startsWith(`Year 1: ${chs(1, 4)},Ch. 5Book A,${chs(6, 8)},Ch. 5Book B |`) && (await edRows()).endsWith(`Hidden: ${chs(6, 8)}`),
    "collections: in another view a unit only regroups, even beside one of the same name (then each names its collection)", await edRows());
  await cp.fill("#viewEd [data-vname]", "Terms");
  ok((await text(cp, '#viewEd [data-view="0"]')) === "Terms", "collections: a view can be renamed");
  await cp.click("#viewEd [data-vadd]"); await cp.waitForTimeout(100);
  ok(await cp.evaluate(() => document.activeElement.matches("#viewEd [data-vname]") && document.activeElement.value === "New view") && (await edRows()) === `Book A: ${chs(1, 11)} | Book B: ${chs(2, 10)},Ch. 12 | Book C: Ch. 11 | Hidden: `,
    "collections: + New view starts as a copy of the main view, its name ready to type", await edRows());
  await cp.keyboard.type("Spare");
  await cp.click("#viewEd [data-vdel]"); await cp.waitForTimeout(100);
  ok(await asking() && (await text(cp, "#askTitle")) === "Delete this view?", "collections: deleting a view asks first");
  await cp.click("#askYes"); await cp.waitForTimeout(100);
  ok((await cp.$$eval("#viewEd [data-view]", (bs) => bs.map((b) => b.textContent).join(","))) === "Books,Terms" && (await cp.$eval("#viewEd [data-view='-1']", (b) => b.getAttribute("aria-pressed"))) === "true", "collections: and then it's gone");
  await cp.click("#viewEd [data-vadd]"); await cp.keyboard.type("Levels");
  await row(0).locator("[data-cname]").fill("Easy\nwords");
  await cp.click("#colSave"); await cp.waitForTimeout(500);
  let sets = await setsNow();
  ok(!(await vis(cp, "#colEd")) && await vis(cp, "#editColBtn") && sets.a12 === "Book B|Ch. 12|Words" && sets.b11 === "Book C|Ch. 11|Words" && [sets.a1, sets.b1].sort().join() === "Book A|Ch. 1|Words,Book A|Ch. 1|Words (2)" && sets.a5 === "Book A|Ch. 5|Words",
    "collections: Save moves the sets, and the merged unit's sets keep different names", JSON.stringify({ a12: sets.a12, b11: sets.b11, a1: sets.a1, b1: sets.b1 }));
  ok((await stored("kanji/ka1"))?.kanji === "水火木" && (await stored("kanji/kb1")) === null && JSON.stringify((await stored("meta/books")).order) === '["Book A","Book B","Book C"]',
    "collections: the merged unit's kanji lists become one, and the collection order is stored", JSON.stringify(await stored("kanji/ka1")));
  let views = await stored("meta/views");
  ok(views?.main === "Books" && views.views.map((v) => v.name).join() === "Terms,Levels" && views.views[1].collections[0].name === "Easy\nwords"
    && JSON.stringify(views.views[0].collections[0].units.slice(-1)) === '[{"collection":"Book B","unit":"Ch. 5"}]' && views.views[0].collections[1].units.some((u) => u.collection === "Book B" && u.unit === "Ch. 12"),
    "collections: the views are stored, their units where the sets now are", JSON.stringify(views?.views?.[0]?.collections?.[1]));
  ok((await switchOf()) === "Books,Terms*,Levels" && (await tRows()).startsWith(`Year 1: ${chs(1, 4)},Ch. 5Book A,${chs(6, 8)},Ch. 5Book B | Year 2: `), "collections: the unit rows stay on the view they showed, under its new name", await switchOf());
  // Another view becomes the main one: the sets move to its collections, and the old main view stays as a view.
  await cp.click("#editColBtn"); await cp.click('#viewEd [data-view="0"]'); await cp.click("#viewEd [data-vmain]"); await cp.waitForTimeout(100);
  ok(await asking() && (await text(cp, "#askTitle")) === "Make “Terms” the main view?" && /become one unit.*Ch\. 5 in Year 1/.test(await text(cp, "#askText")) && /3 units in no collection of Terms go into a collection called Other/.test(await text(cp, "#askText")),
    "collections: making another view the main one says what will merge and what goes to Other", await text(cp, "#askText"));
  await cp.click("#askYes"); await cp.waitForTimeout(150);
  ok((await cp.$$eval("#viewEd [data-view]", (bs) => bs.map((b) => b.textContent).join(","))) === "Terms,Books,Levels" && (await edRows()) === `Year 1: ${chs(1, 8)} | Year 2: ${chs(2, 4)},${chs(9, 12)} | Book B Extras: ${chs(9, 11)} | Other: ${chs(6, 8)}`,
    "collections: it's first, its collections are the main ones, and the old main view is another view", await edRows());
  await cp.click("#colSave"); await cp.waitForTimeout(600);
  sets = await setsNow(); views = await stored("meta/views");
  ok([sets.a5, sets.b5].sort().join() === "Year 1|Ch. 5|Words,Year 1|Ch. 5|Words (2)" && sets.b6 === "Other|Ch. 6|Words" && sets.a12 === "Year 2|Ch. 12|Words" && sets.b11 === "Book B Extras|Ch. 11|Words"
    && JSON.stringify((await stored("meta/books")).order) === '["Year 1","Year 2","Book B Extras","Other"]' && views.main === "Terms" && views.views.map((v) => v.name).join() === "Books,Levels",
    "collections: Save moves every set into the new main view's collections", JSON.stringify({ a5: sets.a5, b5: sets.b5, b6: sets.b6, order: (await stored("meta/books")).order }));
  ok((await switchOf()) === "Terms*,Books,Levels" && /^Year 1: /.test(await tRows()), "collections: the rows show the main view once the view they showed became it", await switchOf());
  await cp.click('#tGroupSeg [data-view="Books"]'); await cp.waitForTimeout(150);
  ok(/^Book A: .* \| Book B: .* \| Book C: Ch\. 11$/.test(await tRows()), "collections: the old main view still groups the units as before", await tRows());
  // Unsaved edits are asked about on leaving; Discard all lets them go.
  await cp.click("#editColBtn"); await drag(unit(3, "Ch. 6"), drop(1));
  await cp.click('#sideNav [data-go="history"]'); await cp.waitForTimeout(200);
  ok(await vis(cp, "#leaveAsk") && /the collections have unsaved changes/.test(await text(cp, "#leaveAsk")), "collections: leaving with unsaved changes asks first", await text(cp, "#leaveAsk"));
  await cp.click("#leaveAsk [data-ldiscard]"); await cp.waitForTimeout(200);
  ok((await setsNow()).b6 === "Other|Ch. 6|Words" && !(await vis(cp, "#table")), "collections: Discard all keeps what's stored");
  // Export carries the views; importing the file elsewhere brings them along.
  await settings(cp, "data");
  const [cdl] = await Promise.all([cp.waitForEvent("download"), cp.click("#exportBtn")]);
  const cfile = JSON.parse(readFileSync(await cdl.path(), "utf8"));
  ok(cfile.views?.main === "Terms" && cfile.views.views.map((v) => v.name).join() === "Books,Levels" && !("courses" in cfile), "export: the views are in the file (and the old courses aren't)", JSON.stringify(cfile.views?.views?.map((v) => v.name)));
  const ectx = await browser.newContext(), ep = await newPage(ectx, { width: 1280 });
  await ep.click("#guestBtn"); await ep.waitForTimeout(400);
  const toTable = async (p) => { if (!(await p.locator('#sideNav [data-go="table"]').isVisible())) { await p.click("#menuBtn"); await p.waitForTimeout(300); } await p.click('#sideNav [data-go="table"]'); await p.waitForTimeout(300); };
  const importIn = async (p, obj, name) => {
    const f = join(out, name); writeFileSync(f, JSON.stringify(obj));
    await settings(p, "data");
    const [ch] = await Promise.all([p.waitForEvent("filechooser"), p.click("#importBtn")]);
    await ch.setFiles(f); await p.waitForTimeout(300);
    const preview = await text(p, "#importPreview");
    await p.click("#importGo"); await p.waitForTimeout(900);
    return preview;
  };
  let preview = await importIn(ep, cfile, "23-export.json");
  await toTable(ep);
  ok(/Views: will change/.test(preview) && JSON.stringify(strip(await stored("meta/views", ep))) === JSON.stringify(cfile.views) && (await switchOf(ep)) === "Terms*,Books,Levels",
    "import: an exported file brings its views along", preview);
  // An older file with courses: they become the view Courses, also where views are saved already.
  const old = { app: "jp-vocab-practice", version: 2, sets: [{ id: "o1", collection: "Old", unit: "Ch. 1", name: "Words", words: [{ id: "w1", en: "fire", kana: "ひ", kanji: "火" }] }, { id: "o2", collection: "Old", unit: "Ch. 2", name: "Words", words: [{ id: "w1", en: "tree", kana: "き", kanji: "木" }] }],
    courses: [{ name: "First term", parts: [{ collection: "Old", from: "Ch. 1", to: "Ch. 1" }] }] };
  preview = await importIn(ep, old, "23-old-courses.json");
  views = await stored("meta/views", ep);
  ok(/Views: will change/.test(preview) && views.views.map((v) => v.name).join() === "Books,Levels,Courses" && JSON.stringify(views.views[2].collections) === '[{"name":"First term","units":[{"collection":"Old","unit":"Ch. 1"}]}]' && (await stored("meta/courses", ep)) === null,
    "import: an older file's courses join views already saved as the view Courses", JSON.stringify(views.views[2]));
  const octx = await browser.newContext(), op = await newPage(octx, { width: 1280 });
  await op.click("#guestBtn"); await op.waitForTimeout(400);
  preview = await importIn(op, old, "23-old-courses.json");
  await toTable(op);
  await op.click('#tGroupSeg [data-view="Courses"]'); await op.waitForTimeout(150);
  ok(/Courses: will change/.test(preview) && (await stored("meta/courses", op))?.courses?.[0]?.name === "First term" && (await tRows(op)) === "First term: Ch. 1",
    "import: in an account without views, an older file's courses read as the view Courses", await tRows(op));
  // A set added to a unit this view hides (as other views do with a new unit) shows: the table goes to the main view.
  await op.fill("#nsCol", "Old"); await op.fill("#nsUnit", "Ch. 2"); await op.fill("#nsName", "More");
  await op.click('#newSetForm [type="submit"]'); await op.waitForTimeout(400);
  ok((await switchOf(op)) === "Books*,Courses" && await op.evaluate(() => /More/.test(document.activeElement?.closest(".tset.editing")?.querySelector(".tsethead").textContent || "")),
    "views: a set added to a unit the view hides opens on the main view, ready to type in", await switchOf(op));
  await op.click(".tset.editing [data-discard]");
  // A view may be called anything, "main" too: the main view can still be picked.
  await op.click("#editColBtn"); await op.click('#viewEd [data-view="0"]'); await op.fill("#viewEd [data-vname]", "main");
  await op.click("#colSave"); await op.waitForTimeout(500);
  await op.click('#tGroupSeg [data-view="main"]'); await op.waitForTimeout(150);
  const onMain = await switchOf(op);
  await op.click('#tGroupSeg [data-view=""]'); await op.waitForTimeout(150);
  ok(onMain === "Books,main*" && (await switchOf(op)) === "Books*,main", "views: a view called main can be picked, and so can the main view after it", `${onMain} → ${await switchOf(op)}`);
  ok(ep.errors.length === 0 && op.errors.length === 0, "collections import: no page errors", [...ep.errors, ...op.errors].join(" | "));
  await ectx.close(); await octx.close();
  // The switch between views is a dropdown once its buttons would take more than half the header.
  await toTable(cp);
  ok((await cp.$$eval("#tGroupSeg [data-view]", (b) => b.length)) === 3 && !(await cp.$("#tGroupSeg .dd-btn")), "collections: on a big screen the views are buttons");
  await cp.setViewportSize({ width: 390, height: 900 }); await cp.waitForTimeout(300);
  ok(await vis(cp, "#tGroupSeg .dd-btn") && (await cp.$$eval("#tGroupSeg [data-view]", (b) => b.length)) === 0, "collections: on a phone they turn into a dropdown");
  await cp.click("#tGroupSeg .dd-btn"); await cp.click('#tGroupSeg li[data-v="Levels"]'); await cp.waitForTimeout(150);
  ok(/^Easy\nwords: /.test(await tRows()), "collections: and the dropdown switches views", await tRows());
  // On a phone: a unit held still for a moment is picked up (it grows), then dragged; a quick swipe still scrolls.
  await cp.click("#editColBtn"); await cp.waitForTimeout(200);
  ok(await cp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "collections: the editor fits a phone");
  await cp.screenshot({ path: join(out, "23-collections-phone.png"), fullPage: true });
  await row(1).scrollIntoViewIfNeeded();
  const touch = (from, to, hold) => cp.evaluate(async ([[ri, name], ti, hold]) => {
    const rows = [...document.querySelectorAll("#colEd .colrow")], el = [...rows[ri].querySelectorAll(".chip.unit")].find((c) => c.textContent === name);
    const a = el.getBoundingClientRect(), b = rows[ti].querySelector("[data-drop]").getBoundingClientRect(), wait = (ms) => new Promise((d) => setTimeout(d, ms));
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }));
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2, x1 = b.x + 10, y1 = b.y + b.height / 2;
    fire("pointerdown", x0, y0); await wait(100);
    const lifting = el.classList.contains("lifting"); await wait(hold);
    const picked = !!document.querySelector(".dragghost");
    for (let i = 1; i <= 6; i++) { fire("pointermove", x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await wait(16); }
    fire("pointerup", x1, y1); await wait(100);
    return { lifting, picked };
  }, [from, to, hold]);
  const before = await edRows();
  const swipe = await touch([1, "Ch. 9"], 0, 0);
  ok(swipe.lifting && !swipe.picked && (await edRows()) === before, "collections: a finger that moves at once doesn't pick a unit up", JSON.stringify(swipe));
  const held = await touch([1, "Ch. 9"], 0, 450);
  ok(held.lifting && held.picked && (await edRows()).startsWith(`Year 1: ${chs(1, 9)} | Year 2: ${chs(2, 4)},${chs(10, 12)} |`), "collections: held for a moment, it grows, is picked up and dragged to another collection", await edRows());
  await cp.click("#colDiscard");
  ok(cp.errors.length === 0, "collections: no page errors", cp.errors.join(" | "));
  await cctx.close();
}

// ---------- 24. the privacy policy notice: once to a returning visitor after the policy changes, never on a first visit ----------
{
  const updated = readFileSync(join(root, "src/side-pages/privacy.html"), "utf8").match(/Last updated: ([^.]+)\./)[1];
  const nctx = await browser.newContext();
  const np = await newPage(nctx, { init: () => localStorage.setItem("qcard:welcomed", "1") });
  const seen = () => np.evaluate(() => JSON.parse(localStorage.getItem("jpq:policySeen")));
  ok(!(await vis(np, "#policyNote")) && /^\d{4}-\d{2}-\d{2}$/.test(await seen()), "policy notice: a first visit only notes the policy's date", await seen());
  const date = await seen();
  await np.evaluate(() => localStorage.setItem("jpq:policySeen", '"2026-01-01"')); await np.reload(); await np.waitForTimeout(500);
  ok(await vis(np, "#policyNote") && (await text(np, "#policyNote")).includes(updated) && await np.$eval("#policyLink", (a) => a.getAttribute("href")) === "privacy/",
    "policy notice: a visitor who saw an older policy gets the notice, with its date and a link to it", await text(np, "#policyNote"));
  await np.screenshot({ path: join(out, "24-policy-notice.png") });
  await np.click("#policyClose");
  ok(!(await vis(np, "#policyNote")) && (await seen()) === date, "policy notice: closing it notes the date");
  await np.reload(); await np.waitForTimeout(500);
  ok(!(await vis(np, "#policyNote")), "policy notice: it doesn't come back");
  ok(np.errors.length === 0, "policy notice: no page errors", np.errors.join(" | "));
  await nctx.close();
}

// ---------- 25. notebooks: several sets of vocab in one account, one open at a time ----------
{
  const nctx = await browser.newContext({ acceptDownloads: true });
  const np = await newPage(nctx, { width: 1280, init: () => {
    if (localStorage.getItem("qcard:mode")) return;
    const put = (k, v) => localStorage.setItem("qcard:local:" + k, JSON.stringify(v));
    localStorage.setItem("qcard:mode", "local"); put("meta/samples", { offeredAt: "x" });
    put("sets/first", { collection: "Made up", unit: "Week 1", name: "Drinks", words: [{ id: "a", en: "water", kana: "みず", kanji: "水" }, { id: "b", en: "tea", kana: "おちゃ", kanji: "お茶" }] });
    put("data/users/local/settings", { history: true });
    put("data/users/local/t100", { finishedAt: "2026-10-01T00:00:00.000Z", dir: "ej", mode: "default", sets: ["Week 1 › Drinks"], words: [{ id: "a", en: "water", jp: "水", dir: "ej", tries: 2 }] });
  } });
  const ls = (k) => np.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
  const keys = (start) => np.evaluate((s) => Object.keys(localStorage).filter((k) => k.startsWith("qcard:local:" + s)).map((k) => k.slice(12)).sort(), start);
  // (☰ first where the sidebar isn't showing the menu: on a phone, and in Settings.)
  const nbMenu = async () => { if (await vis(np, "#nbList")) return; await np.waitForTimeout(250); if (!(await np.locator("#nbBtn").isVisible())) { await np.click("#menuBtn"); await np.waitForTimeout(300); } await np.click("#nbBtn"); };
  const items = () => np.$$eval("#nbList button", (bs) => bs.map((b) => b.textContent.trim() + (b.getAttribute("aria-checked") === "true" ? "*" : "")).join(", "));
  const nbDo = async (what) => { await nbMenu(); await np.click(`#nbList [data-nb-do="${what}"]`); await np.waitForTimeout(150); };
  const named = async (name, how = "enter") => { await np.fill("#nbNameIn", name); if (how === "enter") await np.keyboard.press("Enter"); else await np.click("#askYes"); await np.waitForTimeout(500); };
  const openNb = async (name) => { await nbMenu(); await np.click(`#nbList [data-nb]:has-text("${name}")`); await np.waitForTimeout(400); };
  const chips = () => np.$$eval("#setPicker [data-set]", (bs) => bs.map((b) => b.dataset.set + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join(","));
  // One notebook to start with, nothing saved for it, and no Delete.
  ok((await text(np, "#nbName")) === "My notebook" && !(await vis(np, "#nbList")) && (await ls("qcard:local:meta/notebooks")) === null, "notebooks: an account starts with one, My notebook, at the top of the sidebar");
  await np.click("#nbBtn");
  ok((await items()) === "My notebook*, New notebook, Rename this notebook" && await np.evaluate(() => document.activeElement?.dataset.nb === "main"), "notebooks: the menu lists it, ticked, with New and Rename (nothing to delete with only one)", await items());
  await np.screenshot({ path: join(out, "25-notebook-menu.png") });
  await np.keyboard.press("Escape");
  ok(!(await vis(np, "#nbList")) && await np.evaluate(() => document.activeElement.id === "nbBtn"), "notebooks: Escape closes the menu");
  if (!/first\*/.test(await chips())) await np.click('#setPicker [data-set="first"]');
  // A new one: named in a pop-up (Enter creates it), opens empty, listed after the first.
  await nbDo("add");
  ok(await np.evaluate(() => document.querySelector("#askDlg").open && document.activeElement.id === "nbNameIn"), "notebooks: New notebook asks for a name");
  await named("Japanese 2");
  const list = (await ls("qcard:local:meta/notebooks"))?.list || [], id2 = list[1]?.id;
  ok(list.length === 2 && list[0].id === "main" && list[0].name === "My notebook" && list[1].name === "Japanese 2" && /^n\w+$/.test(id2 || "") && (await ls("jpq:notebook")) === id2 && (await text(np, "#nbName")) === "Japanese 2",
    "notebooks: Enter creates it and opens it; the list is saved with the account", JSON.stringify(list));
  ok((await chips()) === "" && /No vocab sets yet/.test(await text(np, "#setPicker")) && await vis(np, "#emptySamples"), "notebooks: a new notebook is empty, with the same ways to fill it as a new account", await text(np, "#setPicker"));
  // What's added goes into the open notebook, beside the first one's documents (which stay where they always were).
  await np.click("#emptySamples"); await np.waitForTimeout(1200);
  const in2 = await keys(`notebooks/${id2}/sets/`);
  ok(in2.length === 6 && in2.every((k) => /\/sets\/samples-/.test(k)) && (await keys("sets/")).join() === "sets/first" && (await chips()).split(",").length === 6, "notebooks: the sample sets added there are saved under that notebook, not the first", in2.join(", "));
  // Each notebook keeps its own picks.
  const pick2 = in2[0].split("/").pop();
  if (!(await chips()).includes(pick2 + "*")) await np.click(`#setPicker [data-set="${pick2}"]`);
  await np.waitForTimeout(100);
  ok((await ls("jpq:selected"))?.join() === "first" && (await ls("jpq:nbPicks"))?.[id2]?.selected?.includes(pick2), "notebooks: the sets picked are kept per notebook", JSON.stringify(await ls("jpq:nbPicks")).slice(0, 160));
  // Vocabulary shows the open notebook; another opened from there with unsaved changes asks first.
  await goTable(np);
  const sids = await np.$$eval("#table [data-sid]", (xs) => xs.map((x) => x.dataset.sid)), ts = `[data-sid="${sids[0]}"]`;
  ok(sids.length > 0 && sids.every((x) => x.startsWith("samples-")), "notebooks: Vocabulary shows the open notebook's sets only", sids.join(","));
  await np.click(`${ts} [data-toggle]`); await np.click(`${ts} [data-edit]`); await np.fill(`${ts} [data-ef="tags"]`, "mine");
  await openNb("My notebook");
  ok((await text(np, "#nbName")) === "Japanese 2" && /^1 set has unsaved changes\./.test(await text(np, "#leaveAsk")), "notebooks: opening another one from Vocabulary with unsaved changes asks what to do with them", await text(np, "#leaveAsk"));
  await np.click("#leaveAsk [data-ldiscard]"); await np.waitForTimeout(400);
  ok((await text(np, "#nbName")) === "My notebook" && await vis(np, "#table") && !!(await np.$('[data-sid="first"]')) && !(await np.$(ts)), "notebooks: then it opens, still on Vocabulary, with its own sets");
  await goView(np, "setup");
  ok((await chips()) === "first*", "notebooks: back in the first one, its picks are as they were", await chips());
  // A practice notes its notebook; Progress names it and counts the hard words of the open one.
  await np.evaluate((id) => localStorage.setItem("qcard:local:data/users/local/t101", JSON.stringify({ finishedAt: "2026-10-02T00:00:00.000Z", dir: "ej", mode: "default", sets: ["Greetings"], nb: id,
    words: [{ id: "zz", en: "hello there", jp: "こんにちは", dir: "ej", tries: 3 }] })), id2);
  await np.reload(); await np.waitForTimeout(600);
  await goView(np, "history");
  const prog = () => np.evaluate(() => ({ tags: [...document.querySelectorAll("#hList .tag")].map((t) => t.textContent).join(","), love: document.querySelector("#history .nbin").textContent, words: [...document.querySelectorAll("#hLove > li .en")].map((e) => e.textContent).join(",") }));
  let pr = await prog();
  ok(pr.tags === "Japanese 2,My notebook" && pr.love === " in My notebook" && pr.words === "water", "progress: each practice says which notebook it was in, and the words that need the most love are the open notebook's", JSON.stringify(pr));
  await openNb("Japanese 2"); pr = await prog();
  ok(await vis(np, "#history") && pr.love === " in Japanese 2" && pr.words === "hello there", "progress: opening another notebook there changes the list to its words", JSON.stringify(pr));
  await np.screenshot({ path: join(out, "25-notebook-progress.png") });
  // A practice started now is saved with the open notebook.
  await goView(np, "setup"); await np.click("#dir-je"); await np.click("#startBtn"); await np.waitForTimeout(300);
  for (let i = 0; i < 40 && await vis(np, "#quiz"); i++) { await scribble(np); await np.click("#checkBtn"); await np.waitForTimeout(150); await np.click("#selfGot"); await np.waitForTimeout(1300); }
  const saved = await np.evaluate(() => Object.keys(localStorage).filter((k) => /data\/users\/local\/t\d{6,}/.test(k)).map((k) => JSON.parse(localStorage.getItem(k)).nb).join(","));
  ok(saved === id2, "notebooks: a finished practice is saved with its notebook", saved);
  // Results belong to the notebook they were practiced in: opening another goes back to Practice.
  const onResults = await vis(np, "#results");
  await openNb("My notebook");
  ok(onResults && await vis(np, "#setup") && (await chips()) === "first*", "notebooks: opening another one from a results page goes to Practice");
  // Export is the open notebook's, and says which; Import adds to the open one.
  await openNb("Japanese 2");
  await settings(np, "data");
  ok((await text(np, "#portPanel h3")) === "Export / import in Japanese 2" && /^6 sets/.test(await text(np, "#setStats")), "settings: the vocab counts and Export / Import say which notebook they are for", await text(np, "#portPanel h3"));
  const [dl] = await Promise.all([np.waitForEvent("download"), np.click("#exportBtn")]);
  const file = JSON.parse(readFileSync(await dl.path(), "utf8"));
  ok(file.notebook === "Japanese 2" && file.sets.length === 6 && !file.sets.some((x) => x.name === "Drinks"), "export: the open notebook's sets, with its name", `${file.notebook}: ${file.sets.length} sets`);
  await openNb("My notebook");
  ok(await setOpen(np) && (await text(np, "#portPanel h3")) === "Export / import in My notebook" && /^1 set\b/.test(await text(np, "#setStats")), "settings: another notebook opened from Settings (☰) stays there, with that notebook's counts", await text(np, "#setStats"));
  const [ch] = await Promise.all([np.waitForEvent("filechooser"), np.click("#importBtn")]);
  const exPath = join(out, "25-notebook-export.json"); writeFileSync(exPath, JSON.stringify(file));
  await ch.setFiles(exPath); await np.waitForTimeout(300);
  const preview = await text(np, "#importPreview");
  await np.click("#importGo"); await np.waitForTimeout(900);
  ok(/Vocab sets: 6 new/.test(preview) && (await keys("sets/")).length === 7 && (await keys(`notebooks/${id2}/sets/`)).length === 6, "import: the file's sets are added to the open notebook", preview);
  // A name another notebook has gets a number; Rename; Delete (only what the open one holds).
  await goView(np, "setup");
  await nbDo("add"); await named("japanese 2", "button");
  ok((await text(np, "#nbName")) === "japanese 2 2", "notebooks: a name that's taken gets a number", await text(np, "#nbName"));
  await nbDo("rename");
  ok((await np.inputValue("#nbNameIn")) === "japanese 2 2", "notebooks: Rename starts from the name it has");
  await named("Kanji drills");
  await nbMenu();
  ok((await items()) === "My notebook, Japanese 2, Kanji drills*, New notebook, Rename this notebook, Delete this notebook" && (await text(np, "#nbName")) === "Kanji drills", "notebooks: renamed; with more than one, the open one can be deleted", await items());
  await np.keyboard.press("Escape");
  await nbDo("delete");
  ok(/This notebook is empty\./.test(await text(np, "#askDlg")), "notebooks: deleting an empty one says it's empty", await text(np, "#askDlg"));
  await np.click("#askYes"); await np.waitForTimeout(600);
  ok((await ls("qcard:local:meta/notebooks")).list.map((n) => n.name).join() === "My notebook,Japanese 2" && (await text(np, "#nbName")) === "My notebook", "notebooks: deleted, and the first one opens");
  await openNb("Japanese 2"); await nbDo("delete");
  const warn = await text(np, "#askDlg");
  await np.click('#askDlg [value="no"]'); await np.waitForTimeout(200);
  ok(/its 6 sets and 3 kanji lists are deleted for good/.test(warn) && (await keys(`notebooks/${id2}/sets/`)).length === 6 && (await text(np, "#nbName")) === "Japanese 2", "notebooks: deleting one with sets says how many go with it; Cancel keeps it", warn);
  await nbDo("delete"); await np.click("#askYes"); await np.waitForTimeout(900);
  ok((await keys("notebooks/")).length === 0 && (await keys("sets/")).length === 7 && (await ls("jpq:nbPicks"))?.[id2] === undefined && (await ls("jpq:notebook")) === "main" && (await chips()).includes("first*"),
    "notebooks: Delete removes that notebook's sets and picks and nothing of the others", (await keys("notebooks/")).join(", "));
  await goView(np, "history"); pr = await prog();
  ok(pr.tags === "" && pr.love === "", "progress: with one notebook left, nothing names notebooks", JSON.stringify(pr));
  // Shrunk to icons, the menu opens beside the sidebar; on a phone it is in the ☰ menu.
  await goView(np, "setup"); await np.click("#menuBtn"); await np.waitForTimeout(200); await np.click("#nbBtn"); await np.waitForTimeout(100);
  const mini = await np.evaluate(() => { const m = document.querySelector("#nbList").getBoundingClientRect(), s = document.querySelector("header.side").getBoundingClientRect(); return { left: Math.round(m.left), side: Math.round(s.right), wide: Math.round(m.width), fits: m.right <= innerWidth && m.bottom <= innerHeight }; });
  ok(mini.left >= mini.side && mini.wide >= 200 && mini.fits, "notebooks: with the sidebar shrunk to icons, the menu opens beside it", JSON.stringify(mini));
  await np.screenshot({ path: join(out, "25-notebook-mini.png") });
  await np.keyboard.press("Escape"); await np.click("#menuBtn");
  await np.setViewportSize({ width: 390, height: 844 }); await np.waitForTimeout(300);
  await np.click("#menuBtn"); await np.waitForTimeout(300); await np.click("#nbBtn"); await np.waitForTimeout(100);
  ok(await np.evaluate(() => { const m = document.querySelector("#nbList").getBoundingClientRect(), s = document.querySelector("#sideNav").getBoundingClientRect(); return m.height > 0 && m.left >= s.left && m.right <= s.right + 1; }) && await np.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "notebooks: on a phone the menu opens inside the ☰ menu");
  await np.screenshot({ path: join(out, "25-notebook-phone.png") });
  await np.click('#nbList [data-nb-do="add"]'); await np.waitForTimeout(300);
  ok(await np.evaluate(() => document.querySelector("#askDlg").open && !document.querySelector("header.side").classList.contains("open")), "notebooks: picking something in it closes the ☰ menu");
  await np.click('#askDlg [value="no"]');
  ok(np.errors.length === 0, "notebooks: no page errors", np.errors.join(" | "));
  await nctx.close();

  // The AI page's Import saves into the notebook that's open on the site, and says which.
  const ictx = await browser.newContext();
  const ip = await newPage(ictx, { init: () => {
    if (localStorage.getItem("qcard:mode")) return;
    localStorage.setItem("qcard:mode", "local"); localStorage.setItem("qcard:local:meta/samples", '{"offeredAt":"x"}');
    localStorage.setItem("qcard:local:meta/notebooks", JSON.stringify({ list: [{ id: "main", name: "My notebook" }, { id: "n2", name: "Japanese 2" }] }));
    localStorage.setItem("jpq:notebook", '"n2"');
  } });
  await ip.goto(base + "ai/"); await ip.waitForTimeout(300);
  const aiFile = join(out, "25-ai-example.json"); writeFileSync(aiFile, example);
  const [aich] = await Promise.all([ip.waitForEvent("filechooser"), ip.click("#aiImportBtn")]);
  await aich.setFiles(aiFile); await ip.waitForTimeout(500);
  const where = await text(ip, "#aiImportPreview [data-where]");
  await ip.click("#aiImportPreview #importGo"); await ip.waitForTimeout(600);
  const aiKeys = await ip.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("qcard:local:") && /\/(sets|kanji)\//.test(k)).map((k) => k.slice(12)).sort());
  ok(/It goes into the notebook “Japanese 2”\.$/.test(where) && aiKeys.length === 3 && aiKeys.every((k) => k.startsWith("notebooks/n2/")), "AI page Import: it saves into the notebook that's open on the site, and says which", `${where} ${aiKeys.join(", ")}`);
  ok(ip.errors.length === 0, "AI page Import into a notebook: no page errors", ip.errors.join(" | "));
  await ictx.close();

  // Signed in: the same, in the account (users/<id>/notebooks/<notebook>/…), following it to another device, and gone with the account.
  const actx = await browser.newContext();
  const ap = await newPage(actx, { width: 1280 });
  await ap.evaluate(() => { window.__nextUser = { uid: "n1", displayName: "Note Booker", email: "nb@example.com" }; });
  await ap.click("#signInBtn"); await ap.waitForTimeout(1500);
  await ap.click("#nbBtn"); await ap.click('#nbList [data-nb-do="add"]'); await ap.fill("#nbNameIn", "Second"); await ap.keyboard.press("Enter"); await ap.waitForTimeout(600);
  let d = await fsData(ap);
  const aid = d["users/n1/meta/notebooks"]?.list?.[1]?.id;
  ok(d["users/n1/meta/notebooks"]?.list?.map((n) => n.name).join() === "My notebook,Second" && /No vocab sets yet/.test(await text(ap, "#setPicker")), "notebooks (signed in): the list is saved in the account", JSON.stringify(d["users/n1/meta/notebooks"]));
  await ap.click("#emptySamples"); await ap.waitForTimeout(1500);
  d = await fsData(ap);
  const under = Object.keys(d).filter((p) => p.startsWith(`users/n1/notebooks/${aid}/`));
  ok(under.filter((p) => p.includes("/sets/")).length === 6 && Object.keys(d).filter((p) => /^users\/n1\/sets\//.test(p)).length === 6, "notebooks (signed in): its sets are saved under users/<id>/notebooks/<notebook>/sets, beside the first one's", under.slice(0, 2).join(", "));
  const apick = under.find((p) => p.includes("/sets/")).split("/").pop();
  if (!(await ap.$eval(`#setPicker [data-set="${apick}"]`, (b) => b.getAttribute("aria-pressed") === "true"))) await ap.click(`#setPicker [data-set="${apick}"]`);
  await ap.waitForTimeout(1400);
  const prefs = (await fsData(ap))["users/n1/data/prefs"] || {};
  ok(prefs.notebook === aid && prefs.nbPicks?.[aid]?.selected?.includes(apick), "notebooks (signed in): the open notebook and its picks are saved with the account's choices", JSON.stringify(prefs.nbPicks).slice(0, 160));
  // Another device: none of this browser's choices, the same account.
  await ap.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("jpq:")).forEach((k) => localStorage.removeItem(k)));
  await ap.reload(); await ap.waitForTimeout(1500);
  ok((await text(ap, "#nbName")) === "Second" && await ap.$eval(`#setPicker [data-set="${apick}"]`, (b) => b.getAttribute("aria-pressed") === "true").catch(() => false), "notebooks (signed in): another device opens the same notebook with the same picks", await text(ap, "#nbName"));
  await settings(ap, "account"); await ap.click("#delStart"); await ap.click("#delYes"); await ap.waitForTimeout(1800);
  d = await fsData(ap);
  ok(!Object.keys(d).some((p) => p.startsWith("users/n1/")), "delete account: every notebook goes with it", Object.keys(d).filter((p) => p.startsWith("users/n1/")).join(", "));
  ok(ap.errors.length === 0, "notebooks (signed in): no page errors", ap.errors.join(" | "));
  await actx.close();
}

// ---------- 26. sharing a notebook by link: the owner's copy, the page a link opens, adding it, the owner's changes arriving ----------
{
  const sctx = await browser.newContext();
  const O = { uid: "o1", displayName: "Owner", email: "o@example.com" }, P = { uid: "s1", displayName: "Sub", email: "s@example.com" };
  const w = (id, en, kana, kanji = "") => ({ id, en, kana, kanji });
  const sp = await newPage(sctx, { width: 1280, init: ([O]) => {
    if (localStorage.getItem("fake:seeded")) return;
    localStorage.setItem("fake:seeded", "1"); localStorage.setItem("qcard:welcomed", "1");
    localStorage.setItem("fake:user", JSON.stringify(O));
    const w = (id, en, kana, kanji = "") => ({ id, en, kana, kanji });
    localStorage.setItem("fake:fs", JSON.stringify({
      "users/o1/meta/samples": { offeredAt: "x" }, "users/s1/meta/samples": { offeredAt: "x" },
      "users/o1/sets/drinks": { collection: "Made up", unit: "Week 1", name: "Drinks", words: [w("a", "water", "みず", "水"), w("b", "tea", "おちゃ", "お茶")], updatedAt: "x" },
      "users/o1/sets/food": { collection: "Made up", unit: "Week 1", name: "Food", words: [w("a", "rice", "ごはん", "ご飯")], updatedAt: "x" },
      "users/o1/kanji/week-1": { collection: "Made up", unit: "Week 1", kanji: "水茶", updatedAt: "x" },
      "users/o1/data/prefs": { secretNote: "not for sharing" },
    }));
  }, initArg: [O] });
  await sp.waitForTimeout(600);
  const fs = () => fsData(sp);
  // Another account, or nobody, in the same browser; and the database changed behind the page's back (as another device would).
  const as = async (u, hash = "") => { await sp.evaluate((u) => { if (u) localStorage.setItem("fake:user", JSON.stringify(u)); else localStorage.removeItem("fake:user"); }, u); await sp.goto(base + hash); await sp.reload(); await sp.waitForTimeout(900); };
  const patch = async (path, doc) => { await sp.evaluate(([path, doc]) => { const d = JSON.parse(localStorage.getItem("fake:fs")); if (doc) d[path] = { ...d[path], ...doc }; else delete d[path]; localStorage.setItem("fake:fs", JSON.stringify(d)); }, [path, doc]); };
  const nbItems = async () => { await sp.click("#nbBtn"); const t = await sp.$$eval("#nbList [data-nb-do]", (bs) => bs.map((b) => b.textContent.trim()).join(", ")); await sp.keyboard.press("Escape"); return t; };
  const nbDo = async (what) => { await sp.click("#nbBtn"); await sp.click(`#nbList [data-nb-do="${what}"]`); await sp.waitForTimeout(200); };
  const words = (d) => (d?.words || []).map((x) => x.en).join(",");
  // The owner: Share in the notebook menu, asked first, then the link.
  ok((await nbItems()) === "New notebook, Rename this notebook, Share this notebook", "share: a signed-in account's notebook menu offers to share it", await nbItems());
  await nbDo("share");
  ok(/Sharing makes a link/.test(await text(sp, "#askDlg")) && !Object.keys(await fs()).some((p) => p.startsWith("shares/")), "share: it says what sharing does, and nothing is shared before Create link", await text(sp, "#askText"));
  await sp.click("#askYes"); await sp.waitForTimeout(900);
  const link = await sp.inputValue("#shareLinkIn"), sid = link.split("#shared/")[1] || "";
  let d = await fs();
  ok(link.startsWith(base + "#shared/") && /^[A-Za-z0-9]{24}$/.test(sid) && d[`shareOwners/${sid}`]?.uid === "o1" && d["users/o1/meta/notebooks"]?.list?.[0]?.share === sid, "share: Create link makes a long random link, kept with the notebook", link);
  const copy = Object.keys(d).filter((p) => p.startsWith(`shares/${sid}/`)).sort().map((p) => p.slice(8 + sid.length)).join(",");
  ok(copy === "kanji/week-1,sets/drinks,sets/food" && d[`shares/${sid}`].name === "My notebook" && d[`shares/${sid}`].rev.length === 3 && words(d[`shares/${sid}/sets/drinks`]) === "water,tea"
    && !JSON.stringify(Object.entries(d).filter(([p]) => p.startsWith("shares/"))).match(/o1|example\.com|secretNote|updatedAt":"x/), "share: the copy holds the notebook's sets and kanji lists, and nothing of the account", copy);
  await sp.screenshot({ path: join(out, "26-share-link.png") });
  await sp.click("#askYes");
  ok((await nbItems()) === "New notebook, Rename this notebook, Shared: link and options", "share: the menu says the notebook is shared", await nbItems());
  // A change in the notebook reaches the copy by itself.
  await goTable(sp);
  await sp.click('[data-sid="drinks"] [data-toggle]'); await sp.click('[data-sid="drinks"] [data-edit]'); await sp.fill("#w-drinks-b-en", "green tea"); await sp.click('[data-sid="drinks"] [data-save]');
  await sp.waitForTimeout(2300);
  ok(words((await fs())[`shares/${sid}/sets/drinks`]) === "water,green tea", "share: a word changed in the notebook is changed in the shared copy a moment later", words((await fs())[`shares/${sid}/sets/drinks`]));
  // Nobody signed in: the link shows the notebook, and adding it needs a sign-in.
  await as(null, "#shared/" + sid);
  const pv = () => sp.evaluate(() => ({ shown: !document.querySelector("#shared").hidden, head: document.querySelector("#sharedHead").textContent.replace(/\s+/g, " ").trim(), btns: [...document.querySelectorAll("#sharedHead button")].map((b) => b.textContent).join(","), body: document.querySelector("#sharedBody").textContent.replace(/\s+/g, " ").trim() }));
  let v = await pv();
  ok(v.shown && /^My notebook A shared notebook: 2 sets · 3 words · 1 kanji list/.test(v.head) && v.btns === "Sign in to add it" && /green tea/.test(v.body) && /Kanji: 水茶/.test(v.body) && new URL(sp.url()).hash === "#shared/" + sid,
    "shared link: someone not signed in sees what's in the notebook, and Sign in to add it", JSON.stringify(v).slice(0, 300));
  await sp.screenshot({ path: join(out, "26-shared-preview.png"), fullPage: true });
  ok(await sp.evaluate(() => Object.keys(localStorage).every((k) => !k.startsWith("qcard:local:notebooks/"))), "shared link: looking adds nothing to this browser");
  // Signing in from there comes back to it, ready to add.
  await sp.evaluate((P) => { window.__nextUser = P; }, P);
  await sp.click("#sharedSignIn"); await sp.waitForTimeout(1500);
  v = await pv();
  ok(v.shown && v.btns === "Add to my notebooks,Add as my own copy" && (await text(sp, "#acctLabel")) === "Sub", "shared link: after signing in the page is back on the shared notebook, with Add to my notebooks", JSON.stringify(v).slice(0, 200));
  await sp.click("#sharedAdd"); await sp.waitForTimeout(1200);
  d = await fs();
  const mineNb = d["users/s1/meta/notebooks"]?.list?.[1], at = `users/s1/notebooks/${mineNb?.id}/`;
  ok(await vis(sp, "#setup") && (await text(sp, "#nbName")) === "My notebook 2" && mineNb?.from === sid && words(d[at + "sets/drinks"]) === "water,green tea" && words(d[at + "sets/drinks"].base) === "water,green tea"
    && d[at + "kanji/week-1"]?.kanji === "水茶" && d[at + "meta/link"]?.share === sid && (await sp.$$eval("#setPicker [data-set]", (b) => b.length)) === 2,
    "add: the shared notebook becomes a notebook in this account, with its sets and kanji list, and opens", JSON.stringify(mineNb));
  ok((await nbItems()) === "New notebook, Rename this notebook, Delete this notebook", "add: a notebook added from somebody's can't itself be shared", await nbItems());
  // Their own changes: a word changed, a word added (the first through the table, to see that saving keeps what came from the owner), a set deleted.
  await goTable(sp);
  ok(/added from a shared one\. Its owner's changes arrive when you open it/.test(await text(sp, "#linkNote")), "added notebook: Vocabulary says where it came from", await text(sp, "#linkNote"));
  await sp.click('[data-sid="drinks"] [data-toggle]'); await sp.click('[data-sid="drinks"] [data-edit]'); await sp.fill("#w-drinks-a-en", "cold water"); await sp.click('[data-sid="drinks"] [data-save]'); await sp.waitForTimeout(500);
  d = await fs();
  ok(words(d[at + "sets/drinks"]) === "cold water,green tea" && words(d[at + "sets/drinks"].base) === "water,green tea", "added notebook: saving a change keeps what came from the owner beside it");
  await patch(at + "sets/drinks", { words: [...d[at + "sets/drinks"].words, w("mine1", "juice", "ジュース")] }); await patch(at + "sets/food", null);
  // Meanwhile the owner changes a word nobody touched, the word this person changed, adds a word and a set, and takes the kanji list's 茶 out.
  await patch("users/o1/sets/drinks", { words: [w("a", "hot water", "おゆ", "お湯"), w("b", "black tea", "こうちゃ", "紅茶"), w("c", "milk", "ぎゅうにゅう", "牛乳")] });
  await patch("users/o1/sets/snacks", { collection: "Made up", unit: "Week 1", name: "Snacks", words: [w("a", "candy", "あめ")] });
  await patch("users/o1/kanji/week-1", { kanji: "水" });
  await as(O); await sp.waitForTimeout(2300);
  d = await fs();
  ok(words(d[`shares/${sid}/sets/drinks`]) === "hot water,black tea,milk" && !!d[`shares/${sid}/sets/snacks`] && d[`shares/${sid}`].rev.length === 4, "share: changes made on another device reach the copy when the owner next opens the notebook");
  // The person who added it opens their notebook: the owner's changes are merged in around their own.
  await as(P); await sp.waitForTimeout(1800);
  d = await fs();
  ok(words(d[at + "sets/drinks"]) === "cold water,black tea,juice,milk" && words(d[at + "sets/drinks"].base) === "hot water,black tea,milk", "update: an untouched word follows the owner, a changed word and an added one stay, the owner's new word arrives", words(d[at + "sets/drinks"]));
  ok(!d[at + "sets/food"] && words(d[at + "sets/snacks"]) === "candy" && d[at + "kanji/week-1"].kanji === "水", "update: a set this person deleted stays deleted, the owner's new set arrives, an untouched kanji list follows", Object.keys(d).filter((p) => p.startsWith(at)).join(", "));
  await goTable(sp); await sp.click("#tOpenAll").catch(() => {}); await sp.waitForTimeout(200);
  const tint = () => sp.$$eval("#setTables tr.own", (rs) => rs.map((r) => r.querySelector("td").textContent).join(","));
  ok((await tint()) === "cold water,juice" && await sp.evaluate(() => getComputedStyle(document.querySelector("#setTables tr.own td")).backgroundColor !== getComputedStyle(document.querySelector("#setTables tr:not(.own) td")).backgroundColor),
    "added notebook: the words this person changed or added are tinted, the owner's are not", await tint());
  await sp.screenshot({ path: join(out, "26-added-notebook.png") });
  // The link, for someone who has the notebook already, and for its owner.
  await as(P, "#shared/" + sid); v = await pv();
  ok(/You've added this notebook/.test(v.head) && v.btns === "Open it", "shared link: someone who added it is told so, with Open it", v.head);
  // Keep it as my own copy: nothing arrives any more, nothing is tinted.
  await sp.click("#sharedOpen"); await goTable(sp);
  await sp.click("#ownCopyBtn"); await sp.click("#askYes"); await sp.waitForTimeout(800);
  d = await fs();
  ok(!d["users/s1/meta/notebooks"].list[1].from && !d[at + "meta/link"] && !d[at + "sets/drinks"].base && words(d[at + "sets/drinks"]) === "cold water,black tea,juice,milk" && !(await vis(sp, "#linkNote")) && (await tint()) === "",
    "own copy: the notebook is cut loose from the shared one and keeps everything it has");
  // From the link again: a copy of their own, and (with the owner's changes) a second linked one for what follows.
  await as(P, "#shared/" + sid);
  await sp.click("#sharedCopy"); await sp.waitForTimeout(1000);
  d = await fs();
  const copyNb = d["users/s1/meta/notebooks"].list[2];
  ok((await text(sp, "#nbName")) === "My notebook 3" && !copyNb.from && !d[`users/s1/notebooks/${copyNb.id}/sets/drinks`].base && !d[`users/s1/notebooks/${copyNb.id}/meta/link`] && words(d[`users/s1/notebooks/${copyNb.id}/sets/drinks`]) === "hot water,black tea,milk",
    "add: Add as my own copy makes a notebook with no tie to the shared one", JSON.stringify(copyNb));
  await as(P, "#shared/" + sid); await sp.click("#sharedAdd"); await sp.waitForTimeout(1000);
  const linkedNb = (await fs())["users/s1/meta/notebooks"].list[3];
  // The owner's own view of the link, then Stop sharing.
  await as(O, "#shared/" + sid); v = await pv();
  ok(/This is your notebook, as people who have the link see it/.test(v.head) && v.btns === "Open it", "shared link: the owner is told it's theirs", v.head);
  await sp.click("#sharedOpen"); await nbDo("share");
  ok((await sp.inputValue("#shareLinkIn")) === link, "share: the menu shows the same link again");
  await sp.click("#shareStop"); await sp.waitForTimeout(200);
  ok(/The link stops working\. People who already added this notebook keep what they have/.test(await text(sp, "#askDlg")), "stop sharing: asks first, and says what happens to people who added it", await text(sp, "#askText"));
  await sp.click("#askYes"); await sp.waitForTimeout(1000);
  d = await fs();
  ok(!Object.keys(d).some((p) => p.startsWith("shares/") || p.startsWith("shareOwners/")) && !d["users/o1/meta/notebooks"].list[0].share && !!d["users/o1/sets/drinks"] && (await nbItems()) === "New notebook, Rename this notebook, Share this notebook",
    "stop sharing: the copy is gone, the notebook itself untouched", Object.keys(d).filter((p) => p.startsWith("share")).join(", "));
  await as(null, "#shared/" + sid); v = await pv();
  ok(/This link doesn't work any more\.\s*The notebook isn't shared now\./.test(v.body) && v.btns === "", "shared link: after Stop sharing it says the link doesn't work any more", v.body);
  // Whoever added it keeps their notebook, and is told nothing more will arrive.
  await as(P); await sp.waitForTimeout(1200);
  d = await fs();
  await goTable(sp);
  ok((await text(sp, "#nbName")) === "My notebook 4" && words(d[`users/s1/notebooks/${linkedNb.id}/sets/drinks`]) === "hot water,black tea,milk" && /isn't shared any more, so nothing in it will change again/.test(await text(sp, "#linkNote")),
    "added notebook: when the owner stops sharing, it stays as it is and says so", await text(sp, "#linkNote"));
  // A shared notebook that's deleted takes its copy with it; so does a deleted account.
  await as(O);
  await nbDo("add"); await sp.fill("#nbNameIn", "Second"); await sp.keyboard.press("Enter"); await sp.waitForTimeout(600);
  await nbDo("share"); await sp.click("#askYes"); await sp.waitForTimeout(900); await sp.click("#askYes");
  const had = Object.keys(await fs()).filter((p) => p.startsWith("shareOwners/")).length;
  await nbDo("delete"); await sp.click("#askYes"); await sp.waitForTimeout(900);
  ok(had === 1 && !Object.keys(await fs()).some((p) => p.startsWith("share")), "share: deleting a shared notebook deletes its shared copy");
  await nbDo("share"); await sp.click("#askYes"); await sp.waitForTimeout(900); await sp.click("#askYes");
  await settings(sp, "account"); await sp.click("#delStart"); await sp.click("#delYes"); await sp.waitForTimeout(1800);
  d = await fs();
  ok(!Object.keys(d).some((p) => p.startsWith("share") || p.startsWith("users/o1/")) && Object.keys(d).some((p) => p.startsWith("users/s1/notebooks/")), "delete account: its shared copies go too; notebooks other people added stay theirs");
  ok(sp.errors.length === 0, "sharing: no page errors", sp.errors.join(" | "));
  await sctx.close();
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);

// Browser tests for the claude.ai copy (build/claude-ai.html), with claude.ai's runtime replaced by a stand-in:
// window.claude.use("db" | "user" | "sample" | "downloads"). They cover what only that copy does, Claude checking the
// handwriting, and that what both versions share (the Check button, import and export) works there too.
// Run: npm run build && node test/claude/run.mjs  (needs Playwright; PLAYWRIGHT_DIR overrides where it lives)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || "/opt/node-tools/node_modules/playwright");
const out = process.env.SHOTS || join(root, "build/test-shots");
mkdirSync(out, { recursive: true });
if (!existsSync(join(root, "build/claude-ai.html"))) { console.error("build/claude-ai.html is missing: run npm run build first."); process.exit(1); }

let failures = 0;
const ok = (cond, msg, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${msg}${extra ? "  " + extra : ""}`); if (!cond) failures++; };

// claude.ai's database has the shape of the site's guest storage (src/account/local.js), so that stands in for it.
const localDb = (await esbuild.build({ stdin: { contents: 'import { makeLocalDb } from "./src/account/local.js"; window.__makeDb = makeLocalDb;', resolveDir: root }, bundle: true, format: "iife", write: false })).outputFiles[0].text;
const runtime = () => {
  window.__asked = []; window.__answers = []; window.__saved = [];
  window.claude = { use: async (name) => ({
    db: window.__makeDb(),
    user: { id: async () => "owner1", isOwner: async () => true, can: async () => true, canEdit: async () => true },
    // Claude: records what it was sent, then gives the next answer the test queued (text, or an error to throw).
    sample: async (prompt, opts) => {
      window.__asked.push({ prompt, cache: opts.cache, images: opts.images.map((b) => ({ type: b.type, size: b.size })) });
      const a = window.__answers.shift();
      if (!a || a.error) throw a?.error || {};
      return { text: a };
    },
    downloads: { save: async (f) => { window.__saved.push(f); } },
  }[name]) };
};
const SET = { collection: "Made up", unit: "Week 1", name: "Food", words: [{ id: "w1", en: "water", kana: "みず", kanji: "水" }, { id: "w2", en: "to eat", kana: "たべる", kanji: "食べる" }] };

const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(readFileSync(join(root, "build/claude-ai.html"))); }).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.setViewportSize({ width: 900, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
await page.addInitScript(localDb);
await page.addInitScript(runtime);
await page.addInitScript((set) => { if (!localStorage.getItem("qcard:local:sets/food")) localStorage.setItem("qcard:local:sets/food", JSON.stringify(set)); }, SET);
await page.goto(base); await page.waitForTimeout(500);

const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? null, sel);
const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.closest("[hidden]") && getComputedStyle(e).display !== "none"; }, sel);
async function scribble(sel) {
  const b = await (await page.$(sel)).boundingBox();
  await page.mouse.move(b.x + 30, b.y + 20); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 30 + i * 8, b.y + 20 + (i % 2) * 15);
  await page.mouse.up();
}
const answer = (a) => page.evaluate((a) => { window.__answers.push(a); }, a);
const asked = () => page.evaluate(() => window.__asked);

// ---------- 1. the page starts against claude.ai's runtime ----------
ok(await page.evaluate(() => document.body.classList.contains("ready")) && await vis('[data-set="food"]'), "starts: the owner's sets show");
ok(!(await page.$("#welcome")) && !(await page.$("#signInBtn")) && !(await page.$("#liveReadOn")), "starts: none of the public site's sign-in, welcome or checker tools are in this copy");

// ---------- 2. Claude checks the handwriting ----------
await page.click('[data-set="food"]'); await page.click("#dir-ej"); await page.click("#startBtn"); await page.waitForTimeout(300);
const first = await text("#qText"), word = (q) => SET.words.find((w) => w.en === q);
await scribble("#mainPad");
await answer(`MAIN: ${word(first).kanji}\nFURIGANA: NONE\nREASON: Correct.\nCORRECT: YES`);
await page.click("#checkBtn"); await page.waitForTimeout(500);
let sent = await asked();
ok(sent.length === 1 && sent[0].images.length === 1 && sent[0].images[0].type === "image/png" && sent[0].images[0].size > 200 && sent[0].cache === false,
  "check: Claude gets one picture of the answer box", JSON.stringify(sent[0]?.images));
ok(sent[0].prompt.includes(`The student saw: "${first}"`) && sent[0].prompt.includes(`reading (kana) = ${word(first).kana}`) && /CORRECT: <YES or NO/.test(sent[0].prompt), "check: the prompt names the word and its expected answer");
ok(/^1 of 2 done/.test(await text("#progLbl")) && (await text("#qText")) !== first && !(await vis("#feedback")), "check: a YES goes straight on to the next word", await text("#progLbl"));
// A wrong answer with furigana: two pictures go (the whole sheet, and the strip larger), and what Claude read is shown.
const second = await text("#qText");
await scribble("#mainPad"); await scribble("#furiPad");
await answer("MAIN: 食べろ\nFURIGANA: た\nREASON: The last kana should be る.\nCORRECT: NO");
await page.click("#checkBtn"); await page.waitForTimeout(500);
sent = await asked();
ok(sent.length === 2 && sent[1].images.length === 2 && sent[1].images.every((i) => i.type === "image/png" && i.size > 200) && /Image 1 shows the whole answer sheet/.test(sent[1].prompt),
  "check with furigana: Claude gets the sheet and the furigana strip", JSON.stringify(sent[1]?.images));
ok(await vis("#feedback") && (await text("#fbReason")) === "The last kana should be る." && (await text("#fbRead")) === "Claude read: furigana 「た」 over 「食べろ」" && await vis("#overrideBtn"),
  "check: a NO shows the reason, what Claude read and the override", await text("#fbRead"));
ok((await page.evaluate(() => document.querySelector("#fbAnswer").innerHTML)) === (word(second).kanji ? `<ruby>${word(second).kanji}<rt>${word(second).kana}</rt></ruby>` : word(second).kana)
  && await page.evaluate(() => document.querySelector("#mainPad").classList.contains("locked")), "check: the right answer shows with its reading, and the pads are locked");
await page.screenshot({ path: join(out, "claude-1-wrong.png"), fullPage: true });
// What can go wrong says so, and Check can be pressed again.
await page.click("#nextBtn"); await page.waitForTimeout(300);
await scribble("#mainPad");
await answer({ error: { code: "rate_limited" } });
await page.click("#checkBtn"); await page.waitForTimeout(400);
ok(/Claude is busy or you've hit a usage limit/.test(await text("#checkErr")) && await vis("#checkErr") && !(await page.evaluate(() => document.querySelector("#checkBtn").disabled)) && !(await vis("#checking")),
  "check: a usage limit is explained and Check works again", await text("#checkErr"));
await answer({ error: {} });
await page.click("#checkBtn"); await page.waitForTimeout(400);
ok((await text("#checkErr")) === "Couldn't reach Claude. Press Check to try again.", "check: any other failure says Claude couldn't be reached", await text("#checkErr"));
await answer("I think this is right!");
await page.click("#checkBtn"); await page.waitForTimeout(400);
ok(/came back in the wrong format/.test(await text("#checkErr")), "check: an answer in the wrong format says so", await text("#checkErr"));
await answer("MAIN: x\nFURIGANA: NONE\nREASON: Correct.\nCORRECT: YES");
await page.click("#checkBtn"); await page.waitForTimeout(500);
ok(await vis("#results") || /^2 of 2 done/.test(await text("#progLbl")), "check: the practice finishes");

// ---------- 3. export and import, shared with the public site ----------
await page.click("#newBtn").catch(() => {}); await page.waitForTimeout(200);
await page.click("#settingsBtn");
ok(await page.evaluate(() => !document.querySelector("#settings").hidden && [...document.querySelectorAll("#setNav [data-set-tab]")].filter((b) => !b.hidden).map((b) => b.textContent).join(", ")) === "Appearance, Data, Practice history",
  "settings: a page with its tabs, without the public site's Account, sharing, Developer tools and Admin");
await page.click('#setNav [data-set-tab="data"]');
ok(await vis("#portPanel") && !(await page.$("#aiHelp")), "settings: export / import is there, without the public site's AI link");
await page.click("#exportBtn"); await page.waitForTimeout(300);
const saved = await page.evaluate(() => window.__saved[0]);
let exported = null; try { exported = JSON.parse(saved.data); } catch {}
ok(/^jp-vocab-\d{4}-\d\d-\d\d\.json$/.test(saved?.filename || "") && exported?.app === "jp-vocab-practice" && exported.sets.length === 1 && exported.sets[0].id === "food" && exported.sets[0].words.length === 2,
  "export: the file has the set, through claude.ai's downloads", saved?.filename);
exported.sets.push({ id: "drinks", collection: "Made up", unit: "Week 2", name: "Drinks", words: [{ id: "w1", en: "tea", kana: "おちゃ", kanji: "お茶" }] });
const file = join(out, "claude-import.json"); writeFileSync(file, JSON.stringify(exported));
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#importBtn")]);
await chooser.setFiles(file); await page.waitForTimeout(300);
ok(/Vocab sets: 1 new, 1 already the same/.test(await text("#importPreview")) && /New: Week 2 › Drinks/.test(await text("#importPreview")) && !(await page.$("#importPreview [data-where]")), "import: the preview lists what's new", await text("#importPreview"));
await page.click("#importGo"); await page.waitForTimeout(500);
ok((await page.evaluate(() => JSON.parse(localStorage.getItem("qcard:local:sets/drinks") || "null")))?.words?.length === 1 && /^Imported: 1 new set\.$/.test(await text("#portMsg")), "import: the new set is saved", await text("#portMsg"));
await page.click("#settingsClose");
ok(await vis('[data-set="drinks"]'), "import: the new set shows on the page");

// ---------- 4. the menu, the same as the public site's without Study tools (a page of the public site) ----------
ok(await page.evaluate(() => [...document.querySelectorAll("#sideNav > *")].map((b) => b.textContent.trim()).join(", ")) === "Practice, Vocabularies, History", "menu: Practice, Vocab table and History, without the public site's Study tools");
await page.setViewportSize({ width: 1280, height: 1000 });
await page.click('#sideNav [data-go="history"]'); await page.waitForTimeout(300);
ok(await vis("#history") && await page.evaluate(() => getComputedStyle(document.querySelector("header.side")).position === "fixed"), "menu: a sidebar on a big screen, and History opens from it");
await page.click('#sideNav [data-go="setup"]'); await page.waitForTimeout(200);

// ---------- 5. views are made in the vocab table's Edit collections and stored in this copy's database ----------
await page.click('#sideNav [data-go="table"]'); await page.waitForTimeout(300);
await page.click("#editColBtn"); await page.click("#viewEd [data-vadd]"); await page.keyboard.type("Term 1");
const mainCols = await page.$$eval("#colEd [data-cname]", (ts) => ts.map((t) => t.value).join("|"));
await page.click("#colSave"); await page.waitForTimeout(400);
const edClosed = !(await vis("#colEd"));
await page.click('#tGroupSeg [data-view="Term 1"]'); await page.waitForTimeout(200);
ok(edClosed && mainCols && await page.$$eval("#tChs .chbook", (ls) => ls.map((l) => l.textContent).join("|")) === mainCols,
  "views: a view added in Edit collections is saved and its rows of units show", await page.$$eval("#tChs .chbook", (ls) => ls.map((l) => l.textContent).join("|")));
await page.click('#sideNav [data-go="setup"]'); await page.waitForTimeout(200);

ok(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close(); server.close();
console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);

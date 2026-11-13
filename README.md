Apologizes for the readme -- I have not modified anything here yet. Will do at a later date. \
I doubt there's any one pulling this stuff to use atm. If you do, Claude's Building instruction should do ok for now. 

# Q-Card: Japanese Vocab Practice

Japanese Vocab Practice (this repository: Q-Card) is a flashcard site for Japanese vocabulary that checks your handwriting. You see a word, write the answer by hand (finger, Apple Pencil or mouse), and the site tells you whether you got it right. Only Japanese is supported at the moment.

**Site:** https://andever2026.github.io/Q-Card/

## What it does

- **Collections, units and sets.** Sets are grouped Collection › Unit › Set: a textbook and its chapters (Nakama 1 › Ch. 3 › A · Greetings), a class and its weeks (Japanese 1 › Week 3 › Food and drink), or anything else. Units sort by name with numbers in order, so Week 2 comes before Week 10. Kanji lists go by unit, and **Kanji learned up to** counts every kanji up to the unit you pick.
- **Practice by hand.** English → 日本語, 日本語 → English, or both. Modes: Default, Force kanji (kanji you've learned must be kanji), Kana only, Katakana only, and Verb forms.
- **Tags.** Give sets tags in their details (Verbs, Quiz 3…). The Filter row above the sets lists every tag in use with how many sets picking it would hide, the ones hiding the most first, and none picked; tapping tags narrows the sets to those tags, and Clear filter shows them all again. When a table has Extras or Supp. sets, Main sets, Extras and Supp. are tags too.
- **Your own vocab.** Everyone brings their own lists: import a vocab file someone shared with you, or type sets into the vocab table. Q-Card ships no textbook lists. New visitors start with a few sample sets (`data/samples.json`: greetings, people, food, katakana words, everyday verbs and time, spread over three units, Week 1 to Week 3, each with a kanji list) so every mode can be tried right away; **Remove the sample sets** under the set picker takes them out for good.
- **Editing a set.** In the vocab table an open set reads as plain text. **Edit** beside its name turns it into fields: its collection, unit, name and tags on top, then its words, each field growing with its text. Fields that differ from what's saved are marked, and nothing is stored until **Save**; **Discard changes** puts the set back. Leaving the table with unsaved changes asks whether to save or discard them, and so does the browser before the page is closed.
- **Private per person.** Sign in with Google and your sets, kanji lists and practice history live in your own space in the database, on any device. Or choose **Continue as a guest** and everything stays in your browser on that device.
- **A 5-minute tour.** First-time visitors can take a guided tour from the welcome pop-up: it rings each part of the page in turn and walks through picking a set, a first practice word, the vocab table and Settings, as a guest. The welcome pop-up only shows on a first visit; after that, signing in is in Settings.
- **Settings.** The gear at the top opens Settings, a page of its own with tabs down the side (on a phone, a list of the tabs): Appearance (colours, light or dark), Account (which account you're using, sign in or out, and deleting your account or, as a guest, everything saved in this browser), Data (how much vocab you have, export and import), Practice history (on or off) and Developer tools (a look at how the checker reads your writing).
- **Choices follow you.** The sets you picked, the filter, direction, mode, Kanji learned up to, colours and light or dark are saved to your account when you're signed in, so they're the same on every device. As a guest they're kept in this browser.
- **Built-in checker.** Compares your strokes with stroke templates for kana and about 2,150 kanji, right in the browser, so your writing never leaves your device. If it misreads your writing you can count the answer as correct yourself. 日本語 → English answers are checked too when you print the meaning the way your set words it; anything else, such as a synonym or joined-up handwriting, you mark yourself.

## Data and privacy

Data is stored in Firebase (Cloud Firestore) under `users/<your account id>/`. The [Firestore rules](firestore.rules) let each signed-in person read and write only their own folder, so other visitors can't see your data. As with any website's database, the site owner can see stored data in the Firebase console. Your choices on the page are saved there too (`users/<id>/data/prefs`). Practice history is saved only after you turn it on, and you can delete it from the History page. Your handwriting isn't kept. Sharing it to help train the checker is built and switched on only for developer accounts for now (a `dev/<id>` document made in the Firebase console), so it can be tried out before it's offered to anyone else. Where it's offered, a signed-in person who hasn't said yes is asked after every 10th finished practice (from the second time, with a "Don't ask me again" box). With sharing on, each answer you check is saved to `users/<id>/training/` with its strokes (points, timing, pen pressure, pen/finger/mouse), the word, and how the checker and you marked it, to build better handwriting recognition for this site and for products made from it. Settings turns it off and deletes what was shared (models already trained on it stay as they are). Guests are never asked. **Delete my account** in Settings deletes all of your data and then your account.

As a guest, the site saves everything in your browser's `localStorage` on that device and sends none of it anywhere. Clearing the site's data in your browser deletes it, so export a copy now and then. To move it to an account later, export it, sign in, and import the file.

Q-Card sets no cookies for tracking or ads and has no analytics. What it stores in your browser (your own data, your choices and your sign-in session) is only what the features you use need. The page's Content Security Policy only lets it talk to Google's sign-in and database services, and it loads nothing from other sites; even its fonts are served from the site itself.

## How the code is laid out

| Path | What it is |
| --- | --- |
| `src/page/` | The page itself. `page.html` is its markup: it pulls in the stylesheet and the code from the folders below with `#include` lines, and is shared with a personal copy that runs as a claude.ai artifact (lines between `#if public` / `#if claude` markers, in any file, go to one version only). Also `styles.css`, `dom.js` (finding elements, escaping text, marking a menu's current button), `dropdown.js` (a dropdown in the page's style), `core.js` (state, storage, views), `settings.js` (the Settings page and its tabs; each tab's part is drawn by the code it belongs to), `nav.js` (the menu: a sidebar on a big screen, ☰ on a smaller one), `data-files.js` and `boot.js` (start-up). |
| `src/theme/` | The look every page shares. `theme.css`: the colours (Blue and Warm, each light and dark) and the pieces drawn the same everywhere, such as buttons; the build also copies it to `css/theme.css` for the side pages. `apply.js`: the one place the colours are set. `pick.js`: the two choices in Settings. `icon.html`: the site's icon. |
| `src/vocab/` | The vocab. `docs.js`: what's stored for a set, a kanji list, the collection order and the courses, and how each is read and cleaned. `data.js` (the vocab as the page holds it), `setup.js` (the practice page and set picker), `table.js` (the vocab table), `courses.js` (courses as rows of units, and their editor in the vocab table), `samples.js` (the sample sets, public site only). |
| `src/import-export/` | Vocab files. `import.js` is the one importer (read the file, preview, write), used by Settings and by the AI page; `import.css` styles its preview. `export.js` writes the file, and `panel.js` is the Export / import part of Settings. `save-file.js` hands the browser a file to download, for the site's exports and the study tools. |
| `src/practice/` | A practice: `practice.js` (asking the words, Resume), `pads.js` (the writing boxes), `verbs.js` (verb forms), `results.js`, `history.js`, `round-list.js` (Admin: the words of this round, public site). |
| `src/checking/` | Checking an answer. `grading.js`: the Check button and showing the result, the same for both versions. `answers.js`: what counts as a right answer (forms, furigana, kanji). `builtin.js` (public site) and `claude.js` (claude.ai copy) are each version's way of reading the handwriting. `checker.js`: the built-in handwriting checker itself. |
| `src/account/` | Where things are kept and who's signed in. `firebase.js`: Google sign-in, the Firestore adapter, file downloads, and the rule for where someone's vocab is kept. `local.js`: guest use, the same database shape in the browser's `localStorage`. `config.js`: the Firebase web config (public by design; the rules protect the data). `account.js` (sign-in, sign-out and deleting, in the page), `menu.js` (the account at the top right: Guest, or the nickname with Settings and Sign out; the nickname itself), `choices.js` (the choices saved to the account, so they're the same on every device) and `share.js` (asking to share handwriting for training, developer accounts only for now). |
| `src/tour/` | The 5-minute tour (public site only). |
| `src/study-tools/` | The Study tools page (`study-tools/`): `tools.html`, and `tools.js`, which puts one card on it per tool. Each tool is a file of its own (`romaji-sheet.js`: a printable sheet of 9 shuffled romaji panels), sharing `pdf.js` (a one-page PDF of text) and `print.js` (printing one sheet). A new tool is a new file added to the list in `tools.js`. |
| `src/side-pages/` | The AI page and the privacy policy: `ai.html` and `privacy.html`, with the `head.html` and `base.css` they share. `pages.js` gives both the colours picked in Settings; `ai.js` is the AI page's Copy and Import buttons. |
| `data/samples.json` | The sample sets new visitors start with, in the same format as an export. Written for this site, not taken from a textbook. |
| `data/templates.json` | Stroke templates for the checker, generated from KanjiVG and the Hershey fonts (`tools/checker/hershey-latin.json`) by `tools/make-templates.mjs`. |
| `fonts/` | The page's fonts, served from the site itself so visitors never contact Google Fonts. `tools/fetch-fonts.mjs` refreshes them. |
| `tools/build.mjs` | Builds the site (`index.html`, `ai/index.html`, `privacy/index.html`, `study-tools/index.html`, `js/*.js`, `css/theme.css`) and `build/claude-ai.html` (the claude.ai copy). |
| `tools/repeats.mjs` | Fails when the same code is written in two places under `src/`. Part of `npm run check`. |
| `llms.txt` | A short pointer for AI tools to the AI page (`ai/`), the page people give to their AI assistant to make an import file (see Vocab files). Everything on that page is in its HTML, for AI tools that don't run scripts. |
| `index.html`, `ai/`, `privacy/`, `study-tools/`, `js/`, `css/` | Built files, committed. `.github/workflows/pages.yml` publishes them from `main`, plus a beta build of the `beta` branch. `js/templates.js` and `js/samples.js` are the two data files above as scripts, which a page opened straight from disk may load (it can't fetch files), so a downloaded copy works offline as a guest by opening `index.html`. The privacy policy's git history (`src/side-pages/privacy.html`) is the list of changes to it. |
| `.nvmrc` | The Node version the build and the tests run on: GitHub reads it, and so does `nvm use`. |
| `CLAUDE.md` | Working rules for Claude sessions on this repo (what to never commit, how changes reach the site). |
| `test/` | Browser tests for the public site (`test/public` with a fake Firebase, `test/emulator` with the real one on the Firebase emulators) and for the claude.ai copy (`test/claude`, with a stand-in for claude.ai), and the checker's accuracy tests (`test/checker`). |

### Building

```sh
npm install
npm run build     # writes index.html, ai/, privacy/, js/*.js, css/theme.css, build/claude-ai.html
npm run check     # fails if the committed built files are out of date, or if code is written twice under src/ (CI runs this)
```

Edit files in `src/`, then build and commit the built files with your change.

The page's code is one function split over the folders of `src/`, each named for what its code does, so the files share names and only work once the build puts them together. Each behaviour has one implementation: the AI page's Import, for example, is the same `import-export/import.js` that Settings uses, included into `js/ai.js` by the build.

### Testing

```sh
node test/public/run.mjs          # sign-in, import, practice, settings, saved choices, CSP (Playwright)
node test/claude/run.mjs          # the claude.ai copy: Claude checking the handwriting, export and import (after npm run build)
node test/checker/eval.mjs --vocab <folder of vocab files>   # built-in checker accuracy and speed
node test/checker/eval-en.mjs --vocab <folder> --hershey <hersheytext package>   # the same for English answers
```

See [test/checker/README.md](test/checker/README.md) for how the checker works, its accuracy numbers and its weak spots. `test/checker/demo.html` is a standalone writing box for trying it out.

GitHub runs both browser tests on every pull request into `main`. The public-site ones swap Firebase for an in-memory fake (`test/public/fake-firebase.js`), and the claude.ai ones swap claude.ai's runtime for a stand-in, so they need no accounts.

`test/emulator/run.mjs` runs the page against the real Firebase SDK and the real `firestore.rules` instead, on the Firebase emulators (Auth and Firestore, project `demo-qcard`, so nothing reaches the real project): signing in from the welcome pop-up with the sample sets and saved choices, a practice left midway with its writing, sharing handwriting and deleting it, Dev tools, Delete my account, and the rules themselves. They need the Firebase CLI and Java 21 or later; the emulators start and stop around the run:

```sh
npm install --no-save playwright firebase-tools   # both at once, or the second install removes the first
npx playwright install chromium
PLAYWRIGHT_DIR=$PWD/node_modules/playwright npx firebase emulators:exec --config test/emulator/firebase.json --only auth,firestore --project demo-qcard "node test/emulator/run.mjs"
```

Or keep the emulators running (`npx firebase emulators:start` with the same options) and run `node test/emulator/run.mjs` as often as you like. GitHub runs these on pull requests into `main` too.

The versions GitHub uses are each written once: Node's in `.nvmrc`, Playwright's and the Firebase CLI's at the top of `.github/workflows/check.yml`.

### Beta site

Changes go to the `beta` branch first. After the build check passes, `.github/workflows/pages.yml` publishes it at [/Q-Card/beta/](https://andever2026.github.io/Q-Card/beta/), next to the live site from `main`. When beta looks right, a pull request from `beta` into `main` runs the full browser tests, and merging it updates the live site.

The beta page is built with `node tools/build.mjs --beta`: it carries a Beta tag and keeps its own browser storage, so guest data and settings there never mix with the live site's. Google sign-in is shared, so signing in on beta uses the same account and data. Publishing needs Settings → Pages → Source set to **GitHub Actions**.

### Firebase setup (for a copy of this project)

1. Create a Firebase project and a Cloud Firestore database, and publish `firestore.rules`.
2. In Authentication → Sign-in method, enable **Google**.
3. In Authentication → Settings → Authorized domains, add the site's domain (for GitHub Pages, `<username>.github.io`).
4. Put the project's web config in `src/account/config.js` and `frame-src` in `tools/build.mjs`, then build.
5. Optionally, to get the Admin tab in Settings (developer-only buttons): sign in once, then in Firestore Database → Data start a collection `dev` with a document whose id is your User UID (Authentication → Users) and any field, like `role` = `dev`. The rules let each person read only their own entry and nobody write one, so only the console can make someone a developer.

## Vocab files

Export and Import use one JSON file:

```json
{
  "app": "jp-vocab-practice",
  "version": 2,
  "sets": [
    { "id": "japanese-1-week-3-food", "collection": "Japanese 1", "unit": "Week 3", "name": "Food and drink", "tags": ["Verbs"],
      "words": [ { "id": "s1", "en": "to eat", "kana": "たべる", "kanji": "食べる" } ] }
  ],
  "kanji": [ { "id": "japanese-1-week-3", "collection": "Japanese 1", "unit": "Week 3", "kanji": "食飲水" } ],
  "collections": { "order": ["Japanese 1"] },
  "courses": { "courses": [ { "name": "Spring", "parts": [ { "collection": "Japanese 1", "from": "Week 1", "to": "Week 8" } ] } ] }
}
```

Import adds new sets and replaces ones with the same `id`; it never deletes. `collections.order` is the order collections are studied in, and `courses` (optional) gather ranges of units into rows of their own. Files exported before units existed (`book`, a numbered `chapter`, `section` and `label`) still import: chapter 3 becomes unit "Ch. 3" and section A with label Greetings becomes the set name "A · Greetings". `tags` is optional (up to 12 per set, matched without case). `kana` and `kanji` may list alternatives with `／` and optional parts in `（）`, like `（お）てんき`. See `test/public/fixtures/sample-export.json`.

Please don't share files copied from copyrighted textbooks publicly.

[`ai/`](https://andever2026.github.io/Q-Card/ai/) is a plain page people can give to their AI assistant along with their vocab list: it explains this format to the assistant (in a folded "For AI assistants" section), and asks it to collect all the material, show how it splits into sets as tables, and make the file once the person agrees. The page has a Copy button for the message to send and its own Import button: it shows the same preview as Settings → Import right there, and saves where the site keeps your vocab (your account when you're signed in, otherwise this browser). `llms.txt` points AI tools to it. Settings links to it beside Import.

## Credits and licenses

Q-Card is licensed under the [GNU Affero General Public License v3.0](LICENSE).

- Handwriting templates in `data/templates.json` are derived from [KanjiVG](https://kanjivg.tagaini.net), © Ulrich Apel, licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). That file is shared under the same license.
- Letter and digit templates come from the Hershey fonts. The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the font data was originally created by James Hurt, Cognition, Inc. Taken from [hersheytext](https://github.com/techninja/hersheytextjs) (MIT).
- Kanji readings come from [KANJIDIC](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), © the Electronic Dictionary Research and Development Group, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- The built site bundles the [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) (Apache-2.0).
- The checker's accuracy tests can also use hand-drawn characters from [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) (MIT) and the Tomoe dictionary via [tegaki](https://github.com/tegaki/tegaki) (LGPL), and the English tests use the single-line fonts in the [hersheytext](https://www.npmjs.com/package/hersheytext) package (MIT; its EMS fonts are SIL OFL). You download them yourself to run those tests; they aren't part of the site or this repository.
- Fonts: [Klee One](https://github.com/fontworks-fonts/Klee) and [Zen Kaku Gothic New](https://github.com/googlefonts/zen-kakugothic), licensed under the SIL Open Font License 1.1 ([fonts/OFL.txt](fonts/OFL.txt)), copied from Google Fonts and served from this site.

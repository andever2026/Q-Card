Apologizes for the readme -- I have not modified anything here yet. Will do at a later date. 
I doubt there's any one pulling this stuff to use atm. If you do, Claude's Building instruction should do ok for now. 

# Q-Card: Japanese Vocab Practice

Japanese Vocab Practice (this repository: Q-Card) is a flashcard site for Japanese vocabulary that checks your handwriting. You see a word, write the answer by hand (finger, Apple Pencil or mouse), and the site tells you whether you got it right. Only Japanese is supported at the moment.

**Site:** https://andever2026.github.io/Q-Card/

## What it does

- **Collections, units and sets.** Sets are grouped Collection › Unit › Set: a textbook and its chapters (Nakama 1 › Ch. 3 › A · Greetings), a class and its weeks (Japanese 1 › Week 3 › Food and drink), or anything else. Units sort by name with numbers in order, so Week 2 comes before Week 10. Kanji lists go by unit, and **Kanji learned up to** counts every kanji up to the unit you pick.
- **Practice by hand.** English → 日本語, 日本語 → English, or both. Modes: Default, Force kanji (kanji you've learned must be kanji), Kana only, Katakana only, and Verb forms.
- **Tags.** Give sets tags in their details (Verbs, Quiz 3…). The Filter row above the sets lists every tag in use with how many sets picking it would hide, the ones hiding the most first, and none picked; tapping tags narrows the sets to those tags, and Clear filter shows them all again. When a table has Extras or Supp. sets, Main sets, Extras and Supp. are tags too.
- **Your own vocab.** Everyone brings their own lists: import a vocab file someone shared with you, or type sets into the vocab table. Q-Card ships no textbook lists. New visitors start with a few sample sets (`data/samples.json`: greetings, people, food, katakana words, everyday verbs and time, spread over three units, Week 1 to Week 3, each with a kanji list) so every mode can be tried right away; **Remove the sample sets** under the set picker takes them out for good.
- **Private per person.** Sign in with Google and your sets, kanji lists and practice history live in your own space in the database, on any device. Or choose **Continue as a guest** and everything stays in your browser on that device.
- **A 5-minute tour.** First-time visitors can take a guided tour from the welcome pop-up: it rings each part of the page in turn and walks through picking a set, a first practice word, the vocab table and Settings, as a guest. The welcome pop-up only shows on a first visit; after that, signing in is in Settings.
- **Settings.** The gear at the top opens Settings: colours, light or dark, which account you're using, sign in or out, how much vocab you have, and deleting your account (or, as a guest, everything saved in this browser).
- **Choices follow you.** The sets you picked, the filter, direction, mode, Kanji learned up to, colours and light or dark are saved to your account when you're signed in, so they're the same on every device. As a guest they're kept in this browser.
- **Built-in checker.** Compares your strokes with stroke templates for kana and about 2,150 kanji, right in the browser, so your writing never leaves your device. If it misreads your writing you can count the answer as correct yourself. 日本語 → English answers are checked too when you print the meaning the way your set words it; anything else, such as a synonym or joined-up handwriting, you mark yourself.

## Data and privacy

Data is stored in Firebase (Cloud Firestore) under `users/<your account id>/`. The [Firestore rules](firestore.rules) let each signed-in person read and write only their own folder, so other visitors can't see your data. As with any website's database, the site owner can see stored data in the Firebase console. Your choices on the page are saved there too (`users/<id>/data/prefs`). Practice history is saved only after you turn it on, and you can delete it from the History page. Your handwriting isn't kept. Sharing it to help train the checker is built and switched on only for developer accounts for now (a `dev/<id>` document made in the Firebase console), so it can be tried out before it's offered to anyone else. Where it's offered, a signed-in person who hasn't said yes is asked after every 10th finished practice (from the second time, with a "Don't ask me again" box). With sharing on, each answer you check is saved to `users/<id>/training/` with its strokes (points, timing, pen pressure, pen/finger/mouse), the word, and how the checker and you marked it, to build better handwriting recognition for this site and for products made from it. Settings turns it off and deletes what was shared (models already trained on it stay as they are). Guests are never asked. **Delete my account** in Settings deletes all of your data and then your account.

As a guest, the site saves everything in your browser's `localStorage` on that device and sends none of it anywhere. Clearing the site's data in your browser deletes it, so export a copy now and then. To move it to an account later, export it, sign in, and import the file.

Q-Card sets no cookies for tracking or ads and has no analytics. What it stores in your browser (your own data, your choices and your sign-in session) is only what the features you use need. The page's Content Security Policy only lets it talk to Google's sign-in and database services, and it loads nothing from other sites; even its fonts are served from the site itself.

## How the code is laid out

| Path | What it is |
| --- | --- |
| `src/app.html` | The page's markup. It pulls in the stylesheet and the app code from `src/app/` with `#include` lines, and is shared with a personal copy that runs as a claude.ai artifact: lines between `#if public` / `#if claude` markers (in any of these files) go to one version only. |
| `src/app/styles.css` | The page's styles, including the light and dark themes. |
| `src/app/*.js` | The app code, one part per file in page order: `core` (state, storage, views), `pads` (the writing boxes), `data` (loading vocab), `verbs` (verb forms), `setup` (the practice page and set picker), `practice` (asking and checking), `answers` (what counts as a right answer: forms, furigana, kanji), `grading`, `results`, `history`, `table` (the vocab table), `export-import`, `public` (public site only: sample sets, built-in checker, sign-in), `tour` (the 5-minute tour, public site only), `share` (asking to share handwriting for training, public site only, developer accounts only for now), `boot`. They're parts of one function, so they share names and only work once the build puts them together. |
| `src/platform/firebase.js` | Public-site platform: Google sign-in, the Firestore adapter, file downloads. |
| `src/platform/local.js` | Guest use (no sign-in): the same database shape, kept in the browser's `localStorage`. |
| `src/platform/config.js` | Firebase web config. These values are public by design; the rules above protect the data. |
| `src/checker.js` | The built-in handwriting checker. |
| `data/samples.json` | The sample sets new visitors start with, in the same format as an export. Written for this site, not taken from a textbook. |
| `data/templates.json` | Stroke templates for the checker, generated from KanjiVG and the Hershey fonts (`tools/checker/hershey-latin.json`) by `tools/make-templates.mjs`. |
| `fonts/` | The page's fonts, served from the site itself so visitors never contact Google Fonts. `tools/fetch-fonts.mjs` refreshes them. |
| `tools/build.mjs` | Builds `index.html` and `js/*.js` (the site) and `build/claude-ai.html` (the claude.ai copy). |
| `index.html`, `js/` | Built files, committed. `.github/workflows/pages.yml` publishes them from `main`, plus a beta build of the `beta` branch. |
| `test/` | Browser tests for the public site (`test/public` with a fake Firebase, `test/emulator` with the real one on the Firebase emulators) and the checker's accuracy tests (`test/checker`). |

### Building

```sh
npm install
npm run build     # writes index.html, js/platform.js, build/claude-ai.html
npm run check     # fails if the committed built files are out of date (CI runs this)
```

Edit files in `src/`, then build and commit the built files with your change.

### Testing

```sh
node test/public/run.mjs          # sign-in, import, practice, settings, saved choices, CSP (Playwright)
node test/checker/eval.mjs --vocab <folder of vocab files>   # built-in checker accuracy and speed
node test/checker/eval-en.mjs --vocab <folder> --hershey <hersheytext package>   # the same for English answers
```

See [test/checker/README.md](test/checker/README.md) for how the checker works, its accuracy numbers and its weak spots. `test/checker/demo.html` is a standalone writing box for trying it out.

GitHub runs the public-site tests on every pull request into `main`. They swap Firebase for an in-memory fake (`test/public/fake-firebase.js`), so they need no accounts.

`test/emulator/run.mjs` runs the page against the real Firebase SDK and the real `firestore.rules` instead, on the Firebase emulators (Auth and Firestore, project `demo-qcard`, so nothing reaches the real project): signing in from the welcome pop-up with the sample sets and saved choices, a practice left midway with its writing, sharing handwriting and deleting it, Dev tools, Delete my account, and the rules themselves. They need the Firebase CLI and Java 21 or later; the emulators start and stop around the run:

```sh
npm install --no-save playwright@1.56.1 firebase-tools@14   # both at once, or the second install removes the first
PLAYWRIGHT_DIR=$PWD/node_modules/playwright npx firebase emulators:exec --config test/emulator/firebase.json --only auth,firestore --project demo-qcard "node test/emulator/run.mjs"
```

Or keep the emulators running (`npx firebase emulators:start` with the same options) and run `node test/emulator/run.mjs` as often as you like. GitHub runs these on pull requests into `main` too.

### Beta site

Changes go to the `beta` branch first. After the build check passes, `.github/workflows/pages.yml` publishes it at [/Q-Card/beta/](https://andever2026.github.io/Q-Card/beta/), next to the live site from `main`. When beta looks right, a pull request from `beta` into `main` runs the full browser tests, and merging it updates the live site.

The beta page is built with `node tools/build.mjs --beta`: it carries a Beta tag and keeps its own browser storage, so guest data and settings there never mix with the live site's. Google sign-in is shared, so signing in on beta uses the same account and data. Publishing needs Settings → Pages → Source set to **GitHub Actions**.

### Firebase setup (for a copy of this project)

1. Create a Firebase project and a Cloud Firestore database, and publish `firestore.rules`.
2. In Authentication → Sign-in method, enable **Google**.
3. In Authentication → Settings → Authorized domains, add the site's domain (for GitHub Pages, `<username>.github.io`).
4. Put the project's web config in `src/platform/config.js` and `frame-src` in `tools/build.mjs`, then build.
5. Optionally, to get Dev tools in Settings: sign in once, then in Firestore Database → Data start a collection `dev` with a document whose id is your User UID (Authentication → Users) and any field, like `role` = `dev`. The rules let each person read only their own entry and nobody write one, so only the console can make someone a developer.

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

## Credits and licenses

Q-Card is licensed under the [GNU Affero General Public License v3.0](LICENSE).

- Handwriting templates in `data/templates.json` are derived from [KanjiVG](https://kanjivg.tagaini.net), © Ulrich Apel, licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). That file is shared under the same license.
- Letter and digit templates come from the Hershey fonts. The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the font data was originally created by James Hurt, Cognition, Inc. Taken from [hersheytext](https://github.com/techninja/hersheytextjs) (MIT).
- Kanji readings come from [KANJIDIC](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), © the Electronic Dictionary Research and Development Group, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- The built site bundles the [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) (Apache-2.0).
- The checker's accuracy tests can also use hand-drawn characters from [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) (MIT) and the Tomoe dictionary via [tegaki](https://github.com/tegaki/tegaki) (LGPL), and the English tests use the single-line fonts in the [hersheytext](https://www.npmjs.com/package/hersheytext) package (MIT; its EMS fonts are SIL OFL). You download them yourself to run those tests; they aren't part of the site or this repository.
- Fonts: [Klee One](https://github.com/fontworks-fonts/Klee) and [Zen Kaku Gothic New](https://github.com/googlefonts/zen-kakugothic), licensed under the SIL Open Font License 1.1 ([fonts/OFL.txt](fonts/OFL.txt)), copied from Google Fonts and served from this site.

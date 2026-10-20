# Q-Card

Q-Card is a flashcard site for Japanese vocabulary that checks your handwriting. You see a word, write the answer by hand (finger, Apple Pencil or mouse), and Q-Card tells you whether you got it right. Only Japanese is supported at the moment.

**Site:** https://andever2026.github.io/Q-Card/

## What it does

- **Practice by hand.** English → 日本語, 日本語 → English, or both. Modes: Default, Force kanji (kanji you've learned must be kanji), Kana only, Katakana only, and Verb forms.
- **Your own vocab.** Everyone brings their own lists: import a vocab file someone shared with you, or type sets into the vocab table. Q-Card ships no textbook lists.
- **Private per person.** Sign in with Google; your sets, kanji lists and practice history live in your own space in the database.
- **Two ways to check answers:**
  - **Built-in checker** (default, free). Compares your strokes with stroke templates for kana and about 2,000 kanji, right in the browser. Your writing never leaves your device. It's less accurate than Claude, so you can always count an answer as correct yourself. 日本語 → English answers are marked by you.
  - **Claude, with your own API key.** Claude reads your writing the way a teacher would, furigana included. Each check is billed to your own Anthropic account.

## Your API key

If you choose Claude, your Anthropic API key is used only from your browser:

- It's sent only to `api.anthropic.com`. It's never saved to Q-Card's database or sent anywhere else, and the page's Content Security Policy blocks it from talking to any other site apart from Google's sign-in and database services.
- By default it's kept for the current tab only (`sessionStorage`) and forgotten when you close the tab.
- Tick **Remember on this device** to keep it in this browser (`localStorage`). Add a passcode and only an encrypted copy is stored (PBKDF2 + AES-GCM); you unlock it once per tab.
- **Forget my key** removes every copy from the browser.
- Best practice: create a separate key just for Q-Card in the [Anthropic Console](https://console.anthropic.com/) with a low monthly spending limit.

## Data and privacy

Data is stored in Firebase (Cloud Firestore) under `users/<your account id>/`. The [Firestore rules](firestore.rules) let each signed-in person read and write only their own folder, so other visitors can't see your data. As with any website's database, the site owner can see stored data in the Firebase console. Practice history is saved only after you turn it on, and you can delete it from the History page.

## How the code is laid out

| Path | What it is |
| --- | --- |
| `src/app.html` | The whole page (HTML, CSS and app code). Shared with a personal copy that runs as a claude.ai artifact; lines between `#if public` / `#if claude` markers go to one version only. |
| `src/platform/firebase.js` | Public-site platform: Google sign-in, the Firestore adapter, file downloads. |
| `src/platform/claude.js` | Checking with a visitor's own API key (Anthropic TypeScript SDK). Loaded only when used. |
| `src/platform/config.js` | Firebase web config. These values are public by design; the rules above protect the data. |
| `src/checker.js` | The built-in handwriting checker. |
| `data/templates.json` | Stroke templates for the checker, generated from KanjiVG by `tools/make-templates.mjs`. |
| `tools/build.mjs` | Builds `index.html` and `js/*.js` (the site) and `build/claude-ai.html` (the claude.ai copy). |
| `index.html`, `js/` | Built files. GitHub Pages serves these straight from the `main` branch, so they're committed. |
| `test/` | Browser tests for the public site (`test/public`) and the checker's accuracy tests (`test/checker`). |

### Building

```sh
npm install
npm run build     # writes index.html, js/platform.js, js/claude.js, build/claude-ai.html
npm run check     # fails if the committed built files are out of date (CI runs this)
```

Edit files in `src/`, then build and commit the built files with your change.

### Testing

```sh
node test/public/run.mjs          # sign-in, import, practice, own-key checks, key storage, CSP (Playwright)
node test/checker/eval.mjs --vocab <folder of vocab files>   # built-in checker accuracy and speed
```

See [test/checker/README.md](test/checker/README.md) for how the checker works, its accuracy numbers and its weak spots. `test/checker/demo.html` is a standalone writing box for trying it out.

The public-site tests swap Firebase for an in-memory fake (`test/public/fake-firebase.js`) and mock Anthropic's API, so they need no accounts or keys.

### Firebase setup (for a copy of this project)

1. Create a Firebase project and a Cloud Firestore database, and publish `firestore.rules`.
2. In Authentication → Sign-in method, enable **Google**.
3. In Authentication → Settings → Authorized domains, add the site's domain (for GitHub Pages, `<username>.github.io`).
4. Put the project's web config in `src/platform/config.js` and `frame-src` in `tools/build.mjs`, then build.

## Vocab files

Export and Import use one JSON file:

```json
{
  "app": "jp-vocab-practice",
  "version": 1,
  "sets": [
    { "id": "sample-ch1-a", "book": "Sample", "chapter": 1, "section": "A", "label": "Food and drink",
      "words": [ { "id": "s1", "en": "to eat", "kana": "たべる", "kanji": "食べる" } ] }
  ],
  "kanji": [ { "id": "sample-ch1", "book": "Sample", "chapter": 1, "kanji": "食飲水" } ],
  "books": { "order": ["Sample"] },
  "courses": null
}
```

Import adds new sets and replaces ones with the same `id`; it never deletes. `kana` and `kanji` may list alternatives with `／` and optional parts in `（）`, like `（お）てんき`. See `test/public/fixtures/sample-export.json`.

Please don't share files copied from copyrighted textbooks publicly.

## Credits and licenses

Q-Card is licensed under the [GNU Affero General Public License v3.0](LICENSE).

- Handwriting templates in `data/templates.json` are derived from [KanjiVG](https://kanjivg.tagaini.net), © Ulrich Apel, licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). That file is shared under the same license.
- Kanji readings come from [KANJIDIC](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), © the Electronic Dictionary Research and Development Group, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- The built site bundles the [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) (Apache-2.0) and the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (MIT).
- The checker's accuracy tests can also use hand-drawn characters from [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) (MIT) and the Tomoe dictionary via [tegaki](https://github.com/tegaki/tegaki) (LGPL). You download them yourself to run those tests; they aren't part of the site or this repository.
- Fonts: Klee One and Zen Kaku Gothic New from Google Fonts (SIL Open Font License).

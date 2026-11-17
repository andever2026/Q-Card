# Notes for Claude

Working rules for any Claude session on this repo, from what the owner has decided. README.md explains the
layout, the build and the tests; this file is what README doesn't say.

## How changes reach the site

- Edit `src/` only, then `npm run build` and commit the built files (`index.html`, `ai/`, `privacy/`, `study-tools/`, `js/`, `css/`)
  with the change. `npm run check` must say "Built files are up to date" and "No code is written twice under src/".
- Everything is shared between the public site and the owner's claude.ai copy (`#if public` / `#if claude` in
  `src/page/page.html` and the scripts). A fix in one version's own section (sign-in, saving, checking) means checking the
  other version's section too.
- Three long-lived branches, each with its own site: `main` is the live site, `beta`
  (https://andever2026.github.io/Q-Card/beta/) holds fixes for what is live, `dev`
  (https://andever2026.github.io/Q-Card/dev/) holds new features. A fix goes to `beta`, and `beta` is merged into
  `dev` so features are built on the fixed code. A feature goes to `dev`, and `dev` is merged into `beta` when the
  owner says it's ready. A big feature can get its own `feature-<name>` branch off `dev`, with its own site at
  /Q-Card/feature-<name>/ (made and removed with the branch): `dev` is merged into it, and it into `dev` when it's ready.
  `main` only through a pull request from `beta`. After each release `main` is merged back into
  `beta` and `dev`. Every one of these is a merge: never squash, rebase or force-push.
- Claude may push to `beta`, `dev` and `feature-` branches (the owner tests there). Never push to `main` or merge into it, or merge `dev`
  into `beta`, until the owner says so.
- Add checks to `test/public/run.mjs` / `test/claude/run.mjs` for what changed. Small changes go to `beta` or `dev` after
  `npm run build` and `npm run check` only, without the full suites (the owner's call: they take ~10 minutes). Run both
  suites (each ends with "All passed") before a pull request into `main`, which also runs them in CI. Changes to
  `src/checking/checker.js` also get `test/checker/eval.mjs` run before and after, and the numbers compared.
- Keep README.md's file list in step with the files.
- A version is looked up when it's chosen or changed (Node in `.nvmrc`, the actions and test tools in
  `.github/workflows/`, packages in `package.json`), never taken from memory: what a session remembers is often a year old.

## Where code goes

- One implementation per behaviour. Before writing something, look for where the site already does it and use that. When
  a second place needs it, it moves into one file that both use (the AI page's Import is Settings' importer,
  `src/import-export/import.js`); it is never written out again. Calling one function from many places is fine.
  `npm run check` fails when the same code is written twice under `src/` (`tools/repeats.mjs`).
- Folders in `src/` are named for what their code does (`page`, `theme`, `vocab`, `import-export`, `practice`,
  `checking`, `account`, `tour`, `side-pages`). New code goes in the folder of its function, or in a new folder named
  the same way. No `shared/`, `utils/` or `misc/`.
- Where the two versions differ, each version's part is a file of its own behind one caller (`checking/builtin.js` and
  `checking/claude.js` behind the one Check button in `checking/grading.js`), not two copies of a function inside `#if`.
- More features are coming, so a change that makes the next one harder to place is worth stopping to restructure first.

## Never

- Textbook vocab (Nakama etc.) in the repo: it's copyrighted. Users bring their own sets; tests use made-up words.
- A Claude/Anthropic API key, or any secret, in the code. (The Firebase web config in `src/account/config.js` is
  public by design.)
- The owner's Firebase UID in the code. Developers are marked by hand in the Firebase console (`dev/<uid>`).
- Privileged behaviour enforced only in the page. Anything only some accounts may do is enforced in `firestore.rules`.
  The owner publishes rule changes in the console by hand, so say when the rules file changed.
- `eval`, inline event handlers or new outside hosts: the page has a strict Content-Security-Policy (the build hashes
  the inline scripts). Fonts are self-hosted.
- Promises written in the owner's name ("never sold", "no ads", and so on) without asking. The wording of
  the privacy policy (`src/side-pages/privacy.html`) is the owner's: ask before changing it.
- Model names in commits, pull requests or code.
- The owner's real name anywhere public: files, comments, commit messages, pull requests. Write "the owner" or
  andever2026.

## Style

- Commits written by Claude say so (a `Co-Authored-By: Claude` trailer): AI-written work stays recognizable, and the
  owner's own commits stay recognizable as theirs.
- Page wording: "practice", never "test"; short, plain sentences.
- Code: match the surrounding code (dense, one idea per line, comments only where the why isn't obvious).

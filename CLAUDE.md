# Notes for Claude

Working rules for any Claude session on this repo, from what the owner has decided. README.md explains the
layout, the build and the tests; this file is what README doesn't say.

## How changes reach the site

- Edit `src/` only, then `npm run build` and commit the built files (`index.html`, `js/`) with the change.
  `npm run check` must say "Built files are up to date".
- Everything is shared between the public site and the owner's claude.ai copy (`#if public` / `#if claude` in
  `src/app.html` and the scripts). A fix in one version's own section (sign-in, saving, checking) means checking the
  other version's section too.
- Branch `beta` deploys to https://andever2026.github.io/Q-Card/beta/, `main` to the live site. Changes go to `beta`
  first; `main` only through a pull request from `beta` (merge method: merge, never squash or force-push).
- Don't push or merge unless the owner asks. The owner tests and pushes.
- Before calling something done, run `node test/public/run.mjs` (it ends with "All passed") and add checks there for
  what changed. Changes to `src/checker.js` also get `test/checker/eval.mjs` run before and after, and the numbers
  compared.
- Keep README.md's file list in step with the files.

## Never

- Textbook vocab (Nakama etc.) in the repo: it's copyrighted. Users bring their own sets; tests use made-up words.
- A Claude/Anthropic API key, or any secret, in the code. (The Firebase web config in `src/platform/config.js` is
  public by design.)
- The owner's Firebase UID in the code. Developers are marked by hand in the Firebase console (`dev/<uid>`).
- Privileged behaviour enforced only in the page. Anything only some accounts may do is enforced in `firestore.rules`.
  The owner publishes rule changes in the console by hand, so say when the rules file changed.
- `eval`, inline event handlers or new outside hosts: the page has a strict Content-Security-Policy (the build hashes
  the inline scripts). Fonts are self-hosted.
- Promises written in the owner's name ("never sold", "no ads", and so on) without asking. The wording of
  `privacy/index.html` is the owner's: ask before changing it.
- Model names in commits, pull requests or code.

## Style

- Commits written by Claude say so (a `Co-Authored-By: Claude` trailer): the owner keeps AI-written work recognizable
  and her own commits recognizable as hers.
- Page wording: "practice", never "test"; short, plain sentences.
- Code: match the surrounding code (dense, one idea per line, comments only where the why isn't obvious).

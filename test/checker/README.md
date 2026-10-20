# Offline handwriting checker

`src/checker.js` checks handwritten Japanese against the answers a card accepts, in the browser, with no network
use beyond loading `data/templates.json` once. Because the expected answer is known, it verifies ("is this one of
these strings?") rather than recognising free text.

## Files

| file | what |
| --- | --- |
| `src/checker.js` | the checker (plain JS, no dependencies; classic script, CommonJS, or bundled) |
| `data/templates.json` | stroke templates for 2,394 characters (209 KB, 151 KB gzipped), generated |
| `tools/make-templates.mjs` | builds the templates from KanjiVG |
| `tools/checker/charset.txt` | the kanji that get templates (the 2,148 kanji the page knows readings for) |
| `test/checker/synth.mjs` | synthetic handwriting, and words composed from hand-drawn reference characters |
| `test/checker/eval.mjs` | accuracy and speed evaluation |
| `test/checker/demo.html` | a writing box for trying the checker by hand |

## API

```js
QCardChecker.init(templatesJson)   // -> { chars, ms }; parses the templates (about 100 ms)
QCardChecker.has(ch)               // -> true if ch has a template
QCardChecker.verify({ strokes, candidates, box: { w, h }, anyKana })
// -> { ok: true | false | null, text, chars: [{ ch, ok, why, got? }], unsupported: [...], ms }
QCardChecker.top(strokes, box, n)  // -> [{ ch, cost, coarse }], best single-character matches (debugging)
```

- `strokes`: `[[[x, y], ...], ...]` in drawing order, CSS px, y down.
- `candidates`: acceptable answers (NFKC). Punctuation (、。・ etc.) may be left out by the writer.
- `anyKana`: every kana position also accepts the same kana in the other script; `text` then gives what was written.
- `ok: true`: the writing matches a candidate; `text` is that candidate as written.
- `ok: false`: `text` is the closest candidate and `chars` goes through it position by position. A failing
  position names the expected character in `ch`, with `why` = `shape`, `small` (should be small), `large`
  (should be full size), `missing`, or `extra` (`ch: ""`, extra writing). `got`, when present, is the character the
  writing looked more like.
- `ok: null`: every candidate has a character without a template (listed in `unsupported`, e.g. 〜); the page
  falls back to self-marking.

Look-alikes across scripts count as the same character: カ力, チ千, エ工, ロ口, タ夕, ニ二, ハ八, ト卜, ー一,
へヘ, べベ, ぺペ, りリ, オ才, ヒ匕, メ乂.

## Rebuilding the templates

KanjiVG's per-character SVGs are needed (the `kanji/` folder of a KanjiVG release or clone):

```sh
node tools/make-templates.mjs --kanjivg path/to/kanjivg/kanji          # add --fetch to download missing files
node tools/make-templates.mjs --kanjivg ... --page src/app.html        # also add kanji from the page's READ_SRC
```

Kana (with small and voiced forms, ゔ, ヴ), ー, 々, 、。・, digits, Latin letters and the kanji look-alikes above
are built in; kanji come from `tools/checker/charset.txt`. Each stroke keeps KanjiVG's order and direction, is
simplified (Douglas-Peucker, 0.7 units) and quantised to 92 levels in the 109-unit box, two printable characters
per point.

## Running the evaluation

```sh
node test/checker/eval.mjs --vocab <folder of vocab set JSON> [--words 400] [--real <folder>] [--verbose 20] [--slow 5]
```

`--vocab` supplies word lists only. `--real` points at a folder holding hand-drawn reference data, used for
testing only and not shipped:

- `ref-patterns.js` from KanjiCanvas (MIT, © Dominik Klein): 2,137 jōyō kanji drawn with jTegaki;
  https://raw.githubusercontent.com/asdfjkl/kanjicanvas/master/docs/resources/javascript/ref-patterns.js
- `handwriting-ja.xml`, the Tomoe dictionary (LGPL) from the tegaki repository: 2,346 kanji and 54 kana, hand drawn
  but reduced to corner points;
  https://raw.githubusercontent.com/tegaki/tegaki/master/tegaki-models/data/train/japanese/handwriting-ja.xml

## How it works

1. **Input.** Strokes are de-duplicated and lightly smoothed, then resampled to 16 points by arc length.
2. **Segmentation.** For each candidate, a dynamic programme splits the strokes into one consecutive group per
   character (a position may be skipped at a cost, trailing strokes count as extra writing), scoring each group
   against the characters allowed there. It runs over three stroke orders (drawing order, left to right, and
   drawing order with late small strokes such as a dakuten moved back to where they sit) and keeps the cheapest.
   A beam and per-character limits on group size keep it fast.
3. **Character cost.** A group and a template are both normalised to their bounding box (longer side = 1, aspect
   kept). Strokes are paired greedily by a Huber-robust mean squared point distance (forward, or reversed at a
   small cost), with a local search that repairs pairs the greedy step got wrong. One user stroke may cover two
   or three consecutive template strokes (cursive joins, in either order for two), two user strokes may cover one
   template stroke, and unpaired strokes on either side cost by length plus a base, so a missing dakuten counts.
   The pairing is then refined once through a damped least-squares affine map (slant, aspect). Stroke order never
   matters.
4. **Judging a position.** Competitors are the 24 nearest templates by a coarse 4-orientation 8×8 feature map,
   the expected character's own 12 nearest templates and its variants (voiced/plain, small/large, other script).
   The 6 closest are re-scored with a time-warped stroke distance. The expected character passes when its cost is
   below a ceiling and no competitor beats it by more than a margin: 0.012 for a character of the same kind, 0.008
   for a variant, 0.03 for the same kana in the other script, 0.05 for a kanji against kana or the reverse. For
   competitors whose template is itself close to the expected one, the margin shrinks to 0.45 of the distance
   between the two templates, so 未/末 or 土/士 are decided between the two shapes. A group fails if much of its ink
   matches no stroke, or if it is far wider than the character (an extra character merged in).
5. **Small kana.** っ/つ, ゃ/や etc. share a shape, so size decides: each other character gives an implied em size
   for the line (median), and the position's size and vertical offset relative to its neighbours give evidence for
   small (written at about 0.65 of full size, on the bottom line). Thresholds loosen when there are fewer than three
   reference characters; a one-character answer is not size-checked.

## Measured

`node test/checker/eval.mjs --words 400 --pairn 12 --real ...` (seed 1, Node 22 on the dev container).
"synth" words are written from the templates with random affine/shear/rotation, per-stroke shifts and scaling,
wobble, mouse-like jitter, stroke-length changes, size and spacing changes, baseline drift, swapped and reversed
strokes, cursive joins and late dakuten. "real" words are composed only from hand-drawn reference characters
(dakuten and small kana built on a hand-drawn base); words with any other character are skipped.

| category | synth n | synth | real n | real | target |
| --- | ---: | ---: | ---: | ---: | --- |
| correct writing accepted | 400 | 97.8% | 324 | 95.4% | accept |
| other kana script accepted with anyKana | 397 | 97.2% | 33 | 100% | accept |
| cross-script look-alike swapped in (力 for カ ...) accepted | 89 | 92.1% | 1 | 100% | accept |
| furigana strip (78 px, small writing) accepted | 266 | 96.6% | | | accept |
| wrong: dakuten/handakuten added, removed or swapped | 270 | 98.9% | 202 | 98.5% | reject |
| wrong: small/large kana swapped | 80 | 83.8% | 58 | 86.2% | reject |
| wrong: confusable swapped (シツ ソン ねれわ ぬめ ...) | 175 | 100% | 151 | 80.1% * | reject |
| wrong: ー or っ left out | 55 | 98.2% | 12 | 100% | reject |
| wrong: one extra character | 400 | 98.3% | 323 | 98.8% | reject |
| wrong: another kanji of similar stroke count | 148 | 100% | 134 | 100% | reject |
| wrong: kana written when only the kanji form is accepted | 288 | 100% | 279 | 99.6% | reject |
| wrong: whole word in the other script, no anyKana | 397 | 99.7% | 33 | 100% | reject |
| furigana strip, wrong answer | 172 | 99.4% | | | reject |
| **all near misses** | 1985 | **98.7%** | | | ≥ 90% |

\* Nearly all of the 30 real misses are one Tomoe ら drawing, accepted as う (う is common, so that swap recurs).
Per distinct drawing, the pair test below rejects 70 of 71.

Single characters, written as A and checked against A and against its confusable partner B (47 pairs plus 28
dakuten pairs, both directions; 12 synthetic writings each and every hand-drawn one): synthetic accepted 99.1%,
rejected as B 97.7%; hand-drawn (71) accepted 100%, rejected as B 98.6%. The weakest synthetic pairs are 午/牛
(67-75% rejected), 未/末, 士/土 (83%).

Every hand-drawn character on its own: KanjiCanvas kanji 99.3% of 2,137 (several misses are mislabelled
patterns, e.g. the 析 pattern is 林), Tomoe kanji 98.7% of 2,346, Tomoe kana 96.3% of 54.

Speed (Node 22, this container, shared CPU): init 103 ms; verify median 16 ms, p95 86 ms, 6-character words
median 26 ms (max 480 ms), 12+ characters median 97 ms. The slowest calls are wrong answers with 15-21-stroke
kanji checked against two candidates (お邪魔します, 天麩羅): 250-480 ms. Phones will be slower by 2-4x.

## Known weak spots

- **Small/large kana** (っ/つ, ゃ/や): only size and height relative to the rest of the line tell them apart, so
  about 15% of swaps pass. One-character answers are never size-checked. Writing kana much smaller than kanji in
  the same word loosens the check further.
- **Shapes that differ only in stroke length** (未/末, 士/土, 午/牛) depend on the writer making the difference
  clear; 17-33% of synthetic swaps pass.
- **Crude kana**: the Tomoe drawings are reduced to corner points, and angular や/ゃ, き, と sometimes lose to
  ヤ/ャ, キ, て; most real-composite misses are of this kind. Writing ら like a う (as one Tomoe drawing does)
  passes as う.
- **Templates are KanjiVG's textbook shapes.** Common handwritten variants that differ in structure (e.g. き or さ
  with the bottom stroke joined, そ in one stroke) depend on the join handling and may be rejected.
- **Strokes drawn in a very different order and joined** (cursive across non-adjacent strokes) are not modelled.
- **Synthetic tests use the same templates the checker uses**, so they flatter it; the hand-drawn sets cover one
  writer per character (kanji) and one drawing per kana, mostly neat. There is no real data from students writing
  with a mouse or finger yet.
- **Speed**: complex kanji make the segmentation search and the judging slower; worst seen 480 ms on this machine.

## Attribution

- Templates: KanjiVG, Copyright (C) 2009/2010/2011 Ulrich Apel, CC BY-SA 3.0, https://kanjivg.tagaini.net.
  `data/templates.json` is derived from it and is CC BY-SA 3.0 (its `license` field says so).
- Test data only, not shipped: KanjiCanvas reference patterns, MIT, © Dominik Klein; Tomoe handwriting dictionary
  (LGPL) via the tegaki project.

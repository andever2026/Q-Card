# Offline handwriting checker

`src/checking/checker.js` checks handwritten Japanese, and printed English (see [English](#english)), against the answers a
card accepts, in the browser, with no network use beyond loading `data/templates.json` once. Because the expected answer is known, it verifies ("is this one of
these strings?") rather than recognising free text.

## Files

| file | what |
| --- | --- |
| `src/checking/checker.js` | the checker (plain JS, no dependencies; classic script, CommonJS, or bundled) |
| `data/templates.json` | stroke templates for 2,407 characters plus 62 letter variants (212 KB), generated |
| `tools/make-templates.mjs` | builds the templates from KanjiVG and `tools/checker/hershey-latin.json` |
| `tools/checker/hershey-latin.json` | Hershey "futural" letters, digits and punctuation (SVG path data) |
| `tools/checker/charset.txt` | the kanji that get templates (the 2,148 kanji the page knows readings for) |
| `test/checker/synth.mjs` | synthetic handwriting, words composed from hand-drawn reference characters, and boxes (口, 日) redrawn as one loop or with a line added |
| `test/checker/eval.mjs` | accuracy and speed evaluation |
| `test/checker/synth-en.mjs`, `eval-en.mjs` | synthetic printed English, and the English evaluation |
| `test/checker/demo.html` | a writing box for trying the checker by hand |

## API

```js
QCardChecker.init(templatesJson)   // -> { chars, ms }; parses the templates (about 100 ms)
QCardChecker.has(ch)               // -> true if ch has a template
QCardChecker.verify({ strokes, candidates, box: { w, h }, anyKana, latin })
// -> { ok: true | false | null, text, chars: [{ ch, ok, why, got? }], unsupported: [...], ms }
QCardChecker.top(strokes, box, n)  // -> [{ ch, cost, coarse }], best single-character matches (debugging)
QCardChecker.englishAnswers(meaning) // -> the candidates for an English meaning ("to eat" -> to eat, eat, ...)
```

- `strokes`: `[[[x, y], ...], ...]` in drawing order, CSS px, y down. A tiny mark far from all the other strokes
  (no bigger than 0.15 of their height and more than 0.6 of it away: a tap of the pen) is left out, except in English.
- `candidates`: acceptable answers (NFKC). Punctuation (、。・ etc.) may be left out by the writer, and so may a 〜
  (the mark a set uses for a slot: 〜さん passes as 〜さん or さん; a mark written almost flat, like ー, counts as the 〜).
- `latin`: the candidates are English (see [English](#english)).
- `anyKana`: every kana position also accepts the same kana in the other script; `text` then gives what was written.
- `ok: true`: the writing matches a candidate; `text` is that candidate as written.
- `ok: false`: `text` is the closest candidate and `chars` goes through it position by position. A failing
  position names the expected character in `ch`, with `why` = `shape`, `small` (should be small), `large`
  (should be full size), `missing`, or `extra` (`ch: ""`, extra writing). `got`, when present, is the character the
  writing looked more like. `why` = `strokes` is a kanji that is right but for its strokes, with `strokes` =
  `missing` (one left out), `extra` (one added where the kanji has none), `wrong` (one in the wrong place, e.g.
  彳 written for 亻) or `crossing` (two strokes that should cross don't, e.g. 春's ㇏ started below the third line). Every written position (and the extra writing) has `box`: `[x0, y0, x1, y1]` around its
  strokes, in the coordinates of `strokes`.
- `ok: null`: every candidate has a character without a template (listed in `unsupported`, e.g. 龘); the page
  falls back to self-marking.

Look-alikes across scripts count as the same character: カ力, チ千, エ工, ロ口, タ夕, ニ二, ハ八, ト卜, ー一,
へヘ, べベ, ぺペ, りリ, オ才, ヒ匕, メ乂. `text` then has the character the candidate has (ジュース, never ジュ一ス).

## Rebuilding the templates

KanjiVG's per-character SVGs are needed (the `kanji/` folder of a KanjiVG release or clone):

```sh
node tools/make-templates.mjs --kanjivg path/to/kanjivg/kanji          # add --fetch to download missing files
node tools/make-templates.mjs --kanjivg ... --page src/checking/answers.js  # also add kanji from the page's READ_SRC
```

Kana (with small and voiced forms, ゔ, ヴ), ー, 々, 、。・, digits, Latin letters and the kanji look-alikes above
are built in; kanji come from `tools/checker/charset.txt`. Each stroke keeps KanjiVG's order and direction, is
simplified (Douglas-Peucker, 0.7 units) and quantised to 92 levels in the 109-unit box, two printable characters
per point. The Hershey letters, digits and ASCII punctuation in `tools/checker/hershey-latin.json` are added the
same way (closed loops kept), with each letter's pen-down form in `alt` (see [English](#english)). KanjiVG has no 〜, so
its one wavy stroke is drawn in `make-templates.mjs` itself; it is only matched where an answer has a 〜, never as a
competitor for another character.

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
   between the two templates, so 未/末 or 土/士 are decided between the two shapes. Templates that close with the
   same stroke count and strokes of the same shapes (only lengths and places differ: 未/末, 士/土, 午/牛, 失/矢,
   天/夫) are also compared by the stroke ends in which they differ: when the other template is at least as close
   and the writing's ends sit more than 0.6 of the way towards it, the position fails. A group fails if much of its
   ink matches no stroke, or if it is far wider than the character (an extra character merged in).
5. **Strokes of a kanji.** A kanji with one stroke left out, added or swapped for a stroke somewhere else is still
   nearer the right kanji than any other, so step 4 passes it. The stroke pairing from step 3 is checked too: a
   template stroke nothing was paired with fails the position unless it was joined into a neighbouring stroke (the
   best pairing of one written stroke with a run of template strokes over it is close and as long as the run, or
   the stroke paired with its neighbour runs along it), and a written stroke paired with nothing fails it unless it
   runs right along other writing (gone over again; not when a second stroke runs alongside it within twice the
   distance, which makes it a line of its own between two lines, as in 目 written for 日) or lies on a stroke of the kanji that the rest of the writing
   leaves room for and touches other writing (a stroke drawn in two pieces; a third line in 日 has no room). When
   both sides have a stroke left over, the position fails only if they are far apart (a sloppy stroke has its
   template stroke nearby). Even with every stroke paired, the position fails when a stroke stands in for one far
   away and of a very different size while lying on another stroke (a dot drawn on the end of 夜's ㇏ for its inner
   dot), or when two strokes that clearly cross in the kanji don't touch in the writing (春's ㇏ must cross the
   third line). Strokes that only meet in the kanji may meet or run past each other. Stroke order never matters. Kana are left to the other checks: they are joined up far more often.
6. **Strokes gone over again.** When the writing fails, it is checked once more with any stroke drawn again over
   another in the same direction left out (it must cover most of the other one's length; dots and dakuten never
   count, and neither does a stroke with other writing alongside it within twice the distance: that is a line
   between two lines). Only then, because strokes written close together in a small hand can look like copies.
7. **Line by line.** Pen strokes are not part of the answer, only the lines drawn: 口 drawn in one go, as a loop, is
   still 口. When the writing still fails and has fewer pen strokes than the closest answer takes, it is checked once
   more with every stroke, written and template, cut where it turns a corner (by more than about 55 degrees, measured
   between two arms a twelfth of the stroke long, sharpest corners first, no piece under a seventh of the stroke; a
   closed loop is cut all the way round; strokes under 0.15 of the writing's height stay whole). Steps 2 to 6 then
   run on the pieces, so a looped box is the four lines of the box. Cutting can lose a corner, so three things are
   stricter in this pass: a template line nothing was paired with counts as joined only with ink along it from
   strokes that lie where they were paired; a line lying off the template line it was paired with, while another
   stroke already draws that one, is an extra line; and anything that isn't a kanji must also pass stroke by stroke,
   from the whole strokes its pieces came from (a kana cut into lines still looks close without its dakuten). The
   verdict of this pass stands when it passes, faults fewer characters, or faults as many for their strokes. Always
   comparing line by line was tried and dropped: corners in real handwriting are too unsteady (correct hand-drawn
   words fell from 91% to 56% accepted).
8. **Small kana.** っ/つ, ゃ/や etc. share a shape, so size decides: each other character gives an implied em size
   for the line (mean of the logs with a quarter cut off at each end), and the position's size (width and height
   ratios averaged) and vertical offset relative to its neighbours give evidence for small (written at about 0.65 of
   full size, on the bottom line). A full-size kana written for a small one fails on fairly weak evidence; a small
   one written for a full-size one needs stronger evidence, more so with fewer than three reference characters, and
   is only checked when its small twin is one people write (っゃゅょ and ァィゥェォッャュョ: a plain い is never failed
   for looking like ぃ). A one-character answer is not size-checked.

## Measured

`node test/checker/eval.mjs --words 400 --pairn 12 --real ...` (seed 1, Node 22 on the dev container).
"synth" words are written from the templates with random affine/shear/rotation, per-stroke shifts and scaling,
wobble, mouse-like jitter, stroke-length changes, size and spacing changes, baseline drift, swapped and reversed
strokes, cursive joins and late dakuten. "real" words are composed only from hand-drawn reference characters
(dakuten and small kana built on a hand-drawn base); words with any other character are skipped.

| category | synth n | synth | real n | real | target |
| --- | ---: | ---: | ---: | ---: | --- |
| correct writing accepted | 400 | 99.3% | 339 | 90.3% | accept |
| other kana script accepted with anyKana | 394 | 96.4% | 30 | 93.3% | accept |
| cross-script look-alike swapped in (力 for カ ...) accepted | 73 | 93.2% | 1 | 100% | accept |
| furigana strip (78 px, small writing) accepted | 230 | 98.3% | | | accept |
| wrong: dakuten/handakuten added, removed or swapped | 295 | 98.0% | 240 | 98.8% | reject |
| wrong: small/large kana swapped | 108 | 97.2% | 87 | 98.9% | reject |
| wrong: confusable swapped (シツ ソン ねれわ ぬめ ...) | 242 | 99.2% | 206 | 84.0% * | reject |
| wrong: ー or っ left out | 47 | 93.6% | 16 | 100% | reject |
| wrong: one extra character | 400 | 99.5% | 337 | 99.7% | reject |
| wrong: another kanji of similar stroke count | 133 | 99.2% | 121 | 99.2% | reject |
| wrong: one stroke of a kanji left out ** | 431 | 94.7% | 431 | 92.8% | reject |
| wrong: one stroke of a kanji added, a quarter of its size away ** | 431 | 63.8% | 431 | 68.0% | reject |
| one stroke of a kanji (most of it) gone over again ** | 431 | 96.3% | 430 | 89.5% | accept |
| wrong: kana written when only the kanji form is accepted | 274 | 100% | 268 | 99.3% | reject |
| wrong: whole word in the other script, no anyKana | 394 | 99.7% | 30 | 100% | reject |
| furigana strip, wrong answer | 150 | 99.3% | | | reject |
| **all near misses** | 2043 | **99.1%** | | | ≥ 90% |

\*\* Added 2026-11-10 with the stroke check (steps 5 and 6), from a separate run (seed 1, 455 words: the six sample
sets and 400 made-up one- and two-kanji words). Before the stroke check the same run gave: stroke left out 43-45%
rejected, stroke added 39-40% rejected, gone over again 62-65% accepted; correct writing went from 96.9% to 96.0%
accepted (synth) and 93.9% to 89.9% (real), and the single hand-drawn kanji below from 99.3% to 98.0% (KanjiCanvas)
and 98.7% to 97.1% (Tomoe). Most of the correct writing it now turns down has strokes joined in a way the pairing
doesn't model (strokes that don't follow each other joined, or four joined in one go).

2026-11-11, a stroke standing in for another, strokes that should cross, and tighter excuses for added strokes (seed 1,
300 words, before -> after): stroke added rejected 74.7% -> 87.4% (real) and 64.6% -> 79.8% (synth), stroke left
out rejected 94.9% -> 96.0% and 94.6% -> 95.3%, gone over again accepted 91.3% -> 88.0% and 96.4% -> 93.9%, correct
writing accepted 92.4% -> 90.7% (real) and 97.7% -> 97.3% (synth), all near misses rejected 90.7% -> 94.2%, single
hand-drawn kanji 98.0% -> 97.9% (KanjiCanvas) and 97.1% -> 96.7% (Tomoe). The crossing rule turns down about 1 in 300
correct single kanji, mostly hand-drawn ones whose strokes really don't cross where the kanji's do (寿, 匕).

2026-11-11, line by line (step 7) and "a line between two lines is not a stroke gone over" (seed 1, 300 words,
before -> after; real / synth): a box of a kanji drawn as one loop accepted 27.3% -> 68.2% (of 44) / 25.0% -> 75.0%
(of 20), correct writing accepted 90.7% -> 91.7% / 97.3% -> 97.7%, gone over again accepted 88.0% -> 88.4% / 93.9% ->
94.6%, stroke added rejected 87.4% -> 87.4% / 79.8% -> 80.9%, stroke left out rejected 96.0% -> 95.7% / 95.3% ->
93.9%, a line added across a box rejected 95.5% / 85.0% (unchanged), another kanji rejected 100% (unchanged), all
near misses 94.1% -> 94.0%, single hand-drawn kanji 97.9% -> 98.6% (KanjiCanvas) and 96.7% -> 96.8% (Tomoe), the
confusable pairs unchanged. The two box rows are new in `eval.mjs` (with seeds of their own, so the older rows read
as before). On single kanji written in template stroke order (250 kanji with a box): one box as a loop accepted
23.6% -> 91.6%, every box as a loop 14.4% -> 90.0%, a line added across a box accepted 4.4% -> 2.4%. Speed with
three jobs running: median 30 -> 39 ms, p95 135 -> 230 ms, slowest 660 -> 999 ms; only answers that fail in fewer
pen strokes than expected take the second pass.

\* Most of the 33 real misses are one Tomoe ら drawing, accepted as う (う is common, so that swap recurs).
Per distinct drawing, the pair test below rejects 70 of 71.

Single characters, written as A and checked against A and against its confusable partner B (47 pairs plus 28
dakuten pairs, both directions; 12 synthetic writings each and every hand-drawn one): synthetic accepted 99.1%,
rejected as B 98.6%; hand-drawn (71) accepted 100%, rejected as B 98.6%. The weakest synthetic pairs are 午/牛
(83-92% rejected), 未/末 and 土/士 (92%).

Every hand-drawn character on its own: KanjiCanvas kanji 99.3% of 2,137 (several misses are mislabelled
patterns, e.g. the 析 pattern is 林), Tomoe kanji 98.7% of 2,346, Tomoe kana 96.3% of 54.

Speed (Node 22, this container, shared CPU, two evaluations running at once): init 150 ms; verify median 22 ms,
p95 106 ms, 6-character words median 26 ms (max 470 ms), 12+ characters median 94 ms. The slowest calls are wrong answers with 15-21-stroke
kanji checked against two candidates (お邪魔します, 天麩羅): 250-480 ms. Phones will be slower by 2-4x.

## Known weak spots

- **Line by line** (step 7): a box drawn as a loop inside a whole word passes about 7 times in 10, less than on its
  own (9 in 10): a corner drawn round, or lost to the smoothing of a loop with few points, leaves the loop a line
  short. It only runs for writing with fewer pen strokes than the answer, so a looped box next to a stroke drawn in
  two pieces gets no second pass. A stroke left out passes a little more often than before (about 1 in 20) when the
  cutting gives the writing a piece too many.
- **Stroke check**: an added stroke that lands right along another stroke of the kanji passes as a stroke gone over
  again or drawn in pieces (about one in six added strokes in the test pass). A misplaced stroke of about the right
  size, paired with the stroke it replaces, is only caught by the overall shape. Strokes joined in a way the pairing
  doesn't model (non-consecutive strokes, or four or more in one go) can look like a stroke left out; this turns
  down about 1 in 25 more correct words than before in the hand-drawn test.

- **Small/large kana** (っ/つ, ゃ/や): only size and height relative to the rest of the line tell them apart, so
  1-5% of swaps pass, more in short words (a small kana written for a full-size one next to only one or two other
  characters is judged loosely). One-character answers are never size-checked. Writing kana much smaller than kanji
  in the same word loosens the check further.
- **Shapes that differ only in stroke length** (未/末, 士/土, 午/牛) depend on the writer making the difference
  clear; 8-17% of synthetic swaps pass. The stroke-end comparison can also turn down a sloppy correct writing that
  is nearer the look-alike (one Tomoe 推, read as 堆).
- **Crude kana**: the Tomoe drawings are reduced to corner points, and angular や/ゃ, き, と sometimes lose to
  ヤ/ャ, キ, て; most real-composite misses are of this kind. Writing ら like a う (as one Tomoe drawing does)
  passes as う.
- **Templates are KanjiVG's textbook shapes.** Common handwritten variants that differ in structure (e.g. き or さ
  with the bottom stroke joined, そ in one stroke) depend on the join handling and may be rejected.
- **Strokes drawn in a very different order and joined** (cursive across non-adjacent strokes) are not modelled.
- **Synthetic tests use the same templates the checker uses**, so they flatter it; the hand-drawn sets cover one
  writer per character (kanji) and one drawing per kana, mostly neat. There is no real data from students writing
  with a mouse or finger yet.
- **Speed**: complex kanji make the segmentation search and the judging slower, and a wrong answer in fewer pen
  strokes than expected is checked a second time, line by line; worst seen 1 s on this machine (two made-up 16-stroke
  kanji, wrong, with other jobs running).

## English

`verify({ latin: true })` checks printed English (the meaning on 日本語 → English cards). The page passes
`englishAnswers(meaning)`: the meaning split into alternatives at commas, semicolons and slashes, a part in
parentheses optional (and kept when short: lip(s), (to) go), "to" before a verb and a leading a / an / the optional,
numbers up to 100 also as words, accents optional. Whatever isn't accepted goes to self-marking on the page, so a
synonym or a misread is never marked wrong.

What differs from Japanese:

- **Templates.** Letters, digits and punctuation from the Hershey "futural" font (`tools/checker/hershey-latin.json`),
  each letter in two forms: as plotted, and pen-down (strokes that start where another ends or on it joined, the
  way people write h, n, b, d in one go). KanjiVG's own letters stay too, except its O, which came out as a point.
  English writing is judged against letters and digits only; Japanese writing never sees the Hershey templates.
- **Case.** A capital is accepted only where a word starts; letters whose capital has the same shape (o, s, c, v,
  w, x, z...) always take both, and size and position decide. Writing in all capitals is left to the student.
- **Punctuation** may be left out.
- **Loops** (o, a, d, 0...) are compared from any starting point and in either direction; an open stroke matched
  to a closed loop costs a little.
- **The line.** Baseline (with slope), x-height, capital height and descender depth are fitted to the whole
  answer by robust least squares. A letter costs extra when its top or bottom sits off where it belongs or when it
  is much wider than its template, which tells p/P, x/X, l/1 and merged letters apart.
- **Ink.** Letters vary more in stroke paths than kana do, so each letter is also compared as ink (an
  oriented-point chamfer distance, both ways), and the lower of the stroke and ink costs counts.
- **Margins.** The expected letter may be 0.03 worse than another letter (0.1 against a digit), never more than
  0.25; no shrinking for close templates.
- **Length.** Answers longer than 32 letters (whole sentences, about 0.5% of the meanings in our sets) aren't
  checked; they are slow and less sure.

`node test/checker/eval-en.mjs --vocab <folder> --hershey <hersheytext package> --n 300` writes meanings from
the vocab files with three single-line fonts the checker has never seen (EMS Readability, Readability Italic and
Tech from the hersheytext package), turned into strokes the way people print (split at reversals, retraced ink
dropped, downstrokes top to bottom, pen kept down between touching pieces), then deformed, slanted, set on a
drifting baseline, with i/j dots and t/f crossbars sometimes added after the word and mouse-like noise. Seeds 1
and 2, Node 22 on the dev container:

| category | n | result | target |
| --- | ---: | ---: | --- |
| correct meaning accepted | 596 | 86.1% | accept |
| correct meaning accepted, neater writing (`--level 0.5`) | 298 | 93.3% | accept |
| correct meaning accepted, written with the template letters (no `--hershey`) | 299 | 93.3% | accept |
| wrong: a random other meaning | 596 | 0.2% accepted | reject |
| wrong: the other meaning closest in spelling (edit distance up to 40%) | 452 | 3.1% accepted | reject |
| wrong: one letter changed | 594 | 4.4% accepted | reject |
| wrong: one letter left out | 594 | 1.2% accepted | reject |

Speed: median 90 ms, p90 350 ms, max 0.9 s per check on this machine; phones will be 2-4x slower.

Known weak spots: joined-up (cursive) writing isn't modelled and falls back to self-marking; most wrong answers
that pass are one look-alike letter away (bad / bag, cheek / check, snow / show, a / o, e / c), which matters
little when checking a meaning; a capital that swallows the next letter can still pass now and then.

## Attribution

- Templates: KanjiVG, Copyright (C) 2009/2010/2011 Ulrich Apel, CC BY-SA 3.0, https://kanjivg.tagaini.net.
  `data/templates.json` is derived from it and is CC BY-SA 3.0 (its `license` field says so).
- Letter, digit and punctuation templates: the Hershey Fonts, originally created by Dr. A. V. Hershey while working at
  the U. S. National Bureau of Standards; the font data format was originally created by James Hurt, Cognition,
  Inc. Taken from hersheytext (https://github.com/techninja/hersheytextjs), © 2014 James T, MIT.
- Test data only, not shipped: KanjiCanvas reference patterns, MIT, © Dominik Klein; Tomoe handwriting dictionary
  (LGPL) via the tegaki project; the hersheytext package's fonts (MIT; its EMS fonts are SIL OFL).

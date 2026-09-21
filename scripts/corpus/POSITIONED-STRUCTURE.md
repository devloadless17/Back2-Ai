# Positioned structure (C1)

Where on the printed page each exercise of the canonical extraction was printed.

```
python scripts/corpus/position_structure.py                 # whole corpus → corpus/.mapping/positioned-structure.json
python scripts/corpus/position_structure.py --show "<paper>" # one paper, printed
python scripts/corpus/test_position_structure.py            # fixtures
```

Inputs: `corpus/exams.json` (the canonical extraction, `extract_exams.py`) and
`corpus/meta/<sha256>/lines.json` (Mathpix lines with page coordinates). Output
is deterministic: same inputs, byte-identical file. The artifact is generated,
not committed (`corpus/` is ignored).

## What this layer is, and is not

- **C1: position.** Where a container was printed. This file.
- **C2: visual occurrence.** Which figure crops fall in which positioned
  region. Not here.
- **C3: semantic ownership.** Which exercise a figure belongs to. Not here.

C1 never creates, merges, splits or renames an academic object. If alignment
fails the answer is AMBIGUOUS or UNRESOLVED, never a different segmentation.
A C1 status says how far a *position* can be trusted. It says nothing about
figures.

## How a container is placed

1. **Tokens.** Both sides are folded (NFKC; tatweel and Arabic diacritics
   removed; alef variants → ا; ى → ي; ة → ه; ھ → ه; no space before a combining
   mark; lower case). LaTeX commands, image references and `$…$` maths are
   dropped. Only words of 3+ letters are kept. Formulas arrive as glyph soup
   on the canonical side and as LaTeX on the Mathpix side, so digits and 1–2
   letter fragments have no counterpart.
2. **Probes.** The first 14 tokens (`PROBE_LEN`) of the container's head:
   - title present: a `heading` probe (title + statement) and a
     `body-fallback` probe (statement only);
   - no title: one `body` probe (statement).
   Probes shorter than 5 tokens (`MIN_PROBE`) are not used.
3. **Score at a position.** The probe's first token must be exactly at that
   position. Each later token must appear within 3 tokens (`WINDOW_SLACK`) of
   the previous match. Score = matched tokens / probe length.
4. **Order.** Containers are placed in extraction order. Each search starts
   after the previous container's anchor (monotonic).
5. **Best position.** Highest score. On a tie, fewest skipped tokens, then
   earliest.
6. **Rival.** The best score of any window that does not overlap the winner
   (distance ≥ probe length).
7. **Anchor.** Snapped to the start of its printed line. If the line directly
   above is a printed exercise heading, or a heading with one short title line
   (≤ 8 tokens) between, the anchor moves up to it.

## Status

Checked in this order; the first that applies wins.

| Status | Rule |
|---|---|
| UNRESOLVED | no usable probe, nothing left after the previous anchor, or best score < 0.45 (`FLOOR_SCORE`) |
| EXACT | score ≥ 0.80 (`EXACT_SCORE`), score − rival ≥ 0.10 (`RIVAL_MARGIN`), and the probe is not `body-fallback` |
| STRONG | score ≥ 0.60 (`STRONG_SCORE`) and score − rival ≥ 0.10 |
| AMBIGUOUS | everything else placed: 0.45–0.60, or a rival within 0.10 |

Then, after all containers are placed: **two containers whose statement spans
start on the same printed line are both AMBIGUOUS**, whatever they scored. Some
Geography question tables are one Mathpix line, and a line has one position.

A `body-fallback` placement is capped at STRONG: the title was not found in
print, so the heading may be above the anchor.

## Spans

`spans` is statement territory: one segment per page, `{page, yStart, yEnd,
lineFrom, lineTo, pageHeight}`, covering the printed lines from the anchor to
the end. The end is the first of these, recorded in `endReason`:

| endReason | What stops it |
|---|---|
| `next-container` | the next placed container's anchor |
| `scheme-marker` | a marking-scheme heading or table header (Barème, Marking scheme, Corrigé, Answer key, أسس التصحيح…, or two of question / answer / marks columns in a table header) |
| `paper-header` | the exam's own header printed again (session line, certificate line, ministry, "PREMIERE SESSION"), which opens a scheme cover or another copy |
| `unclaimed-heading` | a printed exercise heading ("Exercise 3 (5 pts)", "Second exercise", "IV- (8 points)", "Question III", "التمرين الثاني") that is not this container's own. The line directly below the anchor is exempt: a title can sit above its own "Exercise 1" line |
| `paper-end` | nothing: the paper ends |

If the stopping line is preceded on its page only by at most 2 short lines
(≤ 8 tokens), the end moves to the top of that page. A scheme cover's subject
line then goes with the scheme, not the last exercise.

What lies between the end and the next anchor is kept in `trailingSpans`,
positioned but owned by nobody. `leadInSpans` is set on a container when the
previous container was cut at an unclaimed heading, nothing else could own the
region (no other heading inside it, the container is the very next one, and it
did not anchor on a heading of its own), and the canonical text does not
contain it. That happens with a reading passage the extraction dropped.
Lead-in is not statement territory.

`startsInScheme` is true when a scheme marker is on the anchor line or the two
lines below it: the canonical extraction built this container out of a scheme.

## What C2 must not assume

- A figure printed *above* its exercise's heading is outside that exercise's
  span (`gs/2011 1/math_fr.pdf`: "Dans la figure ci-dessus" under a figure at
  y=803, heading at y=854). Inside-the-span is not ownership.
- A figure beside a heading may start a few pixels above it
  (`gs/2013 2/math_en.pdf`, figure top y=1738, heading y=1756).
- Spans are built from text lines. A figure has no tokens, so it never
  extends a span; it can sit in the gap between spans.
- AMBIGUOUS containers still carry spans. Only EXACT and STRONG positions are
  trustworthy.
- `index` repeats inside some papers (bilingual PDFs, scheme containers). The
  key is `(paper, ordinal)`. The same PDF can appear under several tracks
  (`sha256` repeats); its positions are identical.

## Known limit: Arabic Geography

About half of Arabic Geography containers are not placed (49.7% EXACT+STRONG
against 95–99.7% for every other subject and language). The causes are in the
source, not the thresholds: the canonical Arabic text layer is distorted (word
order scrambled, words split), and Mathpix emits some question tables as one
line holding several containers. This family is isolated here, not tuned.

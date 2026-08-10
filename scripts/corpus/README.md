# Corpus OCR

Offline tooling for turning scanned CRDP books into text. Not part of the app;
nothing here imports from `src/`, and the app never runs it.

Two readers, same output shape, so `gates.ts` runs over either and the vendors
stay interchangeable:

| Reader | Command | Good at |
|---|---|---|
| Mathpix | `npm run corpus:mathpix` | Maths and science books — LaTeX out of the box |
| Google Document AI | `npm run corpus:ocr` | Arabic prose — per-token confidence scores |

## Mathpix

Add to `.env`:

```
MATHPIX_APP_ID="..."
MATHPIX_APP_KEY="..."
```

```bash
npm run corpus:mathpix -- --file ./book.pdf --pages 1-30      # test first
npm run corpus:mathpix -- --file ./book.pdf                   # whole book
npm run corpus:gates -- --sha <sha256 it prints>
```

**Books on Google Drive:** install Google Drive for Desktop and pass the path
directly — `--file "G:/My Drive/corpus/falsafa-3amma.pdf"`. Do not use a Drive
share URL: Drive serves an HTML viewer page rather than the PDF, and making
these books link-public is not something to do while the CRDP permission
question is open.

**Page selection happens locally** (pdf-lib), not through a Mathpix option, so
`--pages 1-30` uploads and bills exactly 30 pages.

**Mathpix is not storage.** Source documents are deleted after 30 days and
outputs after 90. What this script writes to `corpus/` is the permanent copy.

`document.mmd` is the fidelity artifact — it carries the LaTeX and table markup.
The per-page `.md` files are derived from the per-line JSON for review and
gating. If a page reports no confidence values the meta file records
`hasConfidence: false` and the run prints a warning: those pages score 1.0, so
confidence gating is not protecting them and only the character-count and
repetition checks apply.

## Google Document AI — Arabic prose path

Covers the unvocalised Arabic books — philosophy, civics, geography, economics,
sociology, history. Literature (`الأدب العربي`) and grammar
(`قواعد اللغة العربية والبلاغة والعروض`) need tashkeel and go through the vision
model instead.

## Setup, once

1. In Google Cloud: enable the Document AI API, create a **Document OCR**
   processor (region `eu` or `us`), and copy its processor ID.
2. Create a service account with the Document AI User role, download a JSON key.
3. Add to `.env`:

```
GOOGLE_APPLICATION_CREDENTIALS="C:/path/to/key.json"
DOCAI_PROJECT="your-gcp-project-id"
DOCAI_LOCATION="eu"
DOCAI_PROCESSOR_ID="abc123def456"
```

4. Install the two dependencies this needs:

```bash
npm install
```

## Run

```bash
# the 30-page test set
npm run corpus:ocr -- --file ./corpus/raw/shared/falsafa-3amma.pdf --pages 1-30
npm run corpus:gates -- --sha <sha256 printed by the previous command>

# a whole book
npm run corpus:ocr -- --file ./corpus/raw/shared/falsafa-3amma.pdf
```

Output:

```
corpus/
  text/<sha256>/page-001.md      the text, line breaks preserved
  meta/<sha256>/page-001.json    confidence, block boxes
  meta/<sha256>/document.json    page counts, mean confidence
  meta/<sha256>/gates.json       flags per page
```

## Notes

**Online processing, 15 pages per request.** Batch processing needs a GCS
bucket, lifecycle rules and IAM; at ~143 requests for the whole Arabic prose
corpus that setup does not pay for itself. If a single book ever exceeds the
online quota, move that book to batch rather than rewriting this.

**Line breaks are load-bearing.** Document AI returns text without structure, so
whitespace is the only signal the segmentation step has left for finding section
boundaries. Do not strip it.

**The gates are separate from the OCR** so thresholds can be re-tuned without
paying to read the pages again. The defaults in `gates.ts` are starting points —
set them from the 30-page test.

**What the gates catch:**

| Flag | Meaning |
|---|---|
| `low-confidence`, `many-weak-tokens` | send the page to the vision model |
| `short-page`, `long-page` | a paragraph was probably skipped or duplicated — invisible in the text itself |
| `repetition-loop` | the reader looped on a degraded page |
| `presentation-forms`, `tatweel`, `arabic-indic-digits` | normalisation has not run yet |
| page count mismatch | blocks the whole book |

**Not handled here:** tables, maps and charts. The OCR processor returns text and
block boxes, not table structure. Pages carrying a figure or table go to the
vision model — roughly 20% of this set, an assumption the 30-page test is meant
to check.

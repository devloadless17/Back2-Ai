# The curriculum

Where the programme in this database comes from, what is authoritative, and
what is still open. Read this before quoting any of it to a school.

---

## The four branches

The Lebanese Baccalaureate has four branches. The application uses these codes:

| Code | Name on the paper | Arabic | Character |
|---|---|---|---|
| `GS` | Sciences Générales | علوم عامة | Maths-heavy sciences |
| `LS` | Sciences de la Vie | علوم الحياة | Biology-heavy sciences |
| `SE` | Sociologie et Économie | اجتماع واقتصاد | Economics and sociology |
| `LH` | Lettres et Humanités | آداب وإنسانيات | Literature and humanities |

**These codes are the single source of truth.** They are what the 38 transcribed
books, every file in `corpus/taxonomy/`, and every row of
`scripts/corpus/catalog.csv` are filed under.

An earlier version of the app used `SG` / `SV` / `VSE` for the first three —
the French initialisms — in `prisma/seed-data.ts` and in
`docs/1-books-checklist.docx`. That left two sets of codes and, once both were
loaded, two parallel curricula under overlapping names with no way to tell which
one a question belonged to. The codes are now unified on the English
initialisms, because re-keying 38 books and their taxonomy files was the riskier
direction. `npm run db:prune` migrates a database that still has the old ones.

> **`docs/1-books-checklist.docx` is now out of date on this point.** It still
> says "use these exact codes — SG, SV, VSE, LH". It should say GS, LS, SE, LH.

---

## What is authoritative

Everything below is derived, not invented.

**Subjects, units and chapters.** Read out of each textbook's own table of
contents by `scripts/corpus/taxonomy.py` — a regex parser, deliberately not a
model, so the result is reproducible and reviewable. Loaded by
`prisma/taxonomy-loader.ts`.

**Which book serves which branch, in which language.** Taken from each book's
own ingestion record (`corpus/meta/<book>/document.json`), written when the PDF
was transcribed. The catalog rows added for the humanities books cite that file
in their `note` column.

**Page provenance.** Every chapter carries the PDF page range it was read from,
so a citation can be traced to a page of a real book.

Current state:

| Branch | Subjects | Chapters |
|---|---|---|
| GS | 9 | 148 |
| LS | 11 | 190 |
| SE | 11 | 127 |
| LH | 11 | 112 |

Run `npm run db:seed:taxonomy -- --dry` for the live figures.

---

## What is NOT in the database yet

**Questions.** The chapters are real; the questions are not ingested. Only the
demo account has questions, and they are written for the demo — see
[DEMO.md](DEMO.md). Real questions arrive through `npm run ingest`.

**Six books have no usable chapter list.** The taxonomy run names them each
time:

- `ejteme3-se`, `tarbeya ls-gs`, `theme1-lh`, `theme-w`, `eng-w-se`, `theme2-lh`
  — the parser found no contents page at all.
- `eng`, `eng-se`, `eng2` — a contents page was found but produced structural
  furniture ("Part D", "The Authors", "Writing Topics") rather than chapters.
  The loader now refuses these rather than seeding them, so English currently
  has **no** chapters in any branch.

Fixing them is a re-run of `scripts/corpus/taxonomy.py` with a TOC override, not
an application change. `corpus/taxonomy/review.html` is the review surface.

---

## What is still unconfirmed — do not present as official

**The subject list per branch.** `docs/1-books-checklist.docx` marks this
"working list, to be confirmed against the CRDP document
*توصيف مواد الامتحانات الرسمية في الشهادة الثانوية العامة بفروعها الأربعة*",
and flags History, Geography, Economics and Sociology with a "?" for some
branches. That confirmation has not happened. What the database contains is the
set of books that were collected — which is evidence of the subject list, not
proof of it.

Concretely: Geography is currently attached to **all four** branches because its
ingestion record says `GS;LS;SE;LH`. That looks wrong for the science branches
and should be checked.

**Exam structure — coefficients, durations and the pass mark.** Not modelled.
The durations in the demo's exam cycles (180 minutes for Life Sciences and
Mathematics, 120 for Physics and Chemistry in the LS branch) are set to match
the real sitting lengths, but they are typed into the demo seed rather than read
from a ministry source, and **subject coefficients are not implemented at all**.

Before any pilot, get the CRDP descriptor document and encode it. Until then the
readiness score weights every subject equally, which is not how the Bac is
marked.

---

## Commands

| | |
|---|---|
| `npm run db:seed:taxonomy` | load the real curriculum |
| `npm run db:seed:taxonomy -- --dry` | report what it would change |
| `npm run db:prune` | remove the invented placeholder taxonomy |
| `npm run db:prune -- --dry` | report what it would remove |
| `npm run db:seed` | full seed — uses the real curriculum when the corpus is present, the placeholder when it is not |
| `npm run db:demo` | the loaded presentation account, on top of the real curriculum |

The placeholder in `prisma/seed-data.ts` now only runs in a checkout without
`corpus/`. It exists so the app is navigable for someone who has cloned the
repository without the books; it is not a second curriculum.

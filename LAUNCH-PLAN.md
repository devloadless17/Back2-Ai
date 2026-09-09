# Launch plan

Written 2026-09-09. Ordered by what it costs a student if it is wrong, not by
how hard it is.

One thing to be clear about at the top: I work when you message me. There is no
mode where I run for twelve hours unattended. Everything in "Mine" below gets
done a turn at a time, and the fastest way through it is to keep the turns
coming. Everything in "Yours" is blocked on you and no amount of my work moves
it.

---

## YOURS — nothing I do substitutes for these

### 1. `RESEND_API_KEY` is absent from production

Not empty — absent from the Vercel environment entirely. With no key,
`sendEmail` logs the message instead of sending it. Five call sites depend on
it:

    api/auth/signup             email verification
    api/auth/forgot-password    password reset
    api/auth/verify-email       resend verification
    api/admin/users             admin invite
    lib/jobs.ts                 scheduled mail

**On launch day a student who forgets their password is locked out of their own
account with no route back, and neither they nor you can fix it from inside the
app.** This outranks every other item in this file combined.

Needs: a Resend account, `bac2.ai` verified as a sending domain, the key added
to Vercel. Then test the full reset flow against production before announcing.

### 2. The production database connection string

Seven commits of corpus work exist only on this laptop. Vercel stores
`DATABASE_URL` as a Secret and will not return its value — `vercel env pull`
writes `[SENSITIVE]` — so it has to come from your Neon dashboard. Use the
**direct** endpoint, not the pooled one; the README warns a pooled connection
fails partway through a corpus load, which is a bad way to find out.

Once I have it:

    DATABASE_URL="<direct>" npm run db:seed:taxonomy -- --dry   # read the "kept" list first
    DATABASE_URL="<direct>" npm run db:seed:taxonomy
    DATABASE_URL="<direct>" npm run merge:chapters -- --apply
    DATABASE_URL="<direct>" npm run corpus:chunks               # WHOLE, never --book
    DATABASE_URL="<direct>" npm run ingest -- --embed-missing
    DATABASE_URL="<direct>" npm run corpus:link-parts

I will count attempts and mastery rows before and after.

### 3. Nobody has checked whether the answers are right

**26 of 4,837 questions are human-verified.** Every number I have produced —
retrieval percentages, passage coverage, barème counts — measures whether the
right *material* reached the model. None of them measures whether the answer
would earn a mark from a Lebanese examiner. For a product taking money that is
the gap that matters, and it needs a person who knows the exam for an hour, not
more code:

    npm run judge:passages -- --count 40
    npm run label:chapters -- --subject <X> --track <Y> --count 30

Three sessions have started a labelling run and recorded zero, because Enter is
"skip" and the runs were abandoned at the prompt.

### 4. Money settings still at demo values

`AI_BUDGET_FREE_USD` and `AI_BUDGET_MONTHLY_USD` are set to $25/$50 against a
measured cost of ~$3.50 for a month of real revision. Code defaults are $1 and
$10. Fine for a demo, expensive with real students.

---

## MINE — in order

### A. Part-level chapter linking, corpus-wide  *(running)*

Proven on history and chemistry. Links an exercise to the chapters its
individual PARTS belong to, at the same 0.65 floor — nothing relaxed. Catches
what whole-exercise ranking cannot: an esterification exercise belongs to both
Alcohols and Carboxylic acids, and a Lebanese history exercise whose part ب is
one line about Iraq belongs to the Iraq chapter. `check:filing` measured 41% of
GS Chemistry exercises as having no single best chapter.

Additive only: never moves a question, never removes a link.

### B. ~~فلسفة عامة missing documents~~ — WITHDRAWN, it was a miscount

I flagged 141 philosophy questions as referencing a document that is not
stored. That was wrong, and checked before acting on it: those questions
average 1,901 characters and none is under 200. A philosophy paper prints a
short quotation to analyse — "ليست الذكريات من طبيعة مادية" — INSIDE the
exercise, so `source_passage` is empty because there is no separate passage,
not because one was lost. The student sees the text.

It was a keyword count matching هذا الرأي and النص in questions whose text was
already there. Same error as "51 questions about العراق" earlier the same
evening. See rule 5.

WHAT MAY STILL BE REAL, and needs the same check before any work:
555 questions across Life Sciences, Physique, Chimie, Physics and Chemistry
have neither a `source_passage` nor a figure, where "document" usually means a
diagram. `scripts/corpus/attach-figures.ts` already exists for that half.

### C. Arabic subjects, worst first

Measured on the current corpus, concept retrieval against chance:

    LH فلسفة عامة   31%     weakest cell in the corpus
    SE فلسفة عامة   40%
    GS فلسفة عامة   56%
    LH أدب عربي     60%
    LS فلسفة عامة   71%

And by barème coverage: أدب عربي marks only 43% of its exercises, and drops 15
papers outright at extraction — the most of any subject.

فلسفة carries no row-by-row barème *by design*, which the user corrected me on
once already; its low score is partly essay questions being scored on chapter
retrieval, which is the wrong question to ask of them. Do not read 31% as "the
worst book in the corpus" — that mistake is recorded in the notes.

### D. Chapters still lopsided

    Life Sciences SE/LH    5 chapters, one holds 62%
    اجتماع SE             12 chapters, one holds 60%
    اقتصاد SE             12 chapters, one holds 41%
    Francais SE            5 chapters, 2 empty, one holds 47%

Each needs a hand-transcribed contents page, as `francais-plaisir-lh` and
`themes-lh-en` got today. Check the scan is page-ordered FIRST — that check is
what stopped me wasting a night on `themes-gsls-en`.

### E. Loose ends I made or found today

- 23 Français LH questions still sit on four old biography chapters. Their best
  match is under the refiler's floor, correctly — they are whole-programme
  prompts belonging to no single theme. Needs a decision, not a rule.
- 2 English SE chapters whose names differ only in wording
  ("Employment, Immigration" vs "Emigration, Employment, Production"). A person
  can see they are one chapter; no rule can.
- `themes-gsls-en` (GS/LS English, worst-structured book in the corpus) **cannot
  be fixed in software**. Its scan has transposed pages — printed 56 sits
  physically before printed 29 — so no single page offset describes it. It needs
  re-scanning.

---

## Rules I have had to learn the hard way today

Written down because each one cost real time.

1. **Run `corpus:chunks` WHOLE, never `--book`.** Since chapters are shared
   between a textbook and its workbook, a single-book run prunes every other
   book's passages from any chapter they share. It deleted 67 history passages
   before I caught it.
2. **`compare_taxonomy --against` rewrites every taxonomy JSON.** Reverting the
   parser does not undo the files. Regenerate before seeding, or scrambled
   chapters go into the database for all 70 subjects.
3. **Query the database, not a filename glob.** Three wrong per-subject answers
   today came from `rglob` plus a regex — accommodation papers inflating counts,
   `SE_Socio_*` files missed entirely.
4. **Read what a metric measures before using it as a baseline.** The
   chapter-routing benchmark structurally cannot reward splitting a chapter, so
   it scored today's best structural fix as a regression.
5. **A keyword count is not a topic.** "51 questions mention العراق" turned out
   to be composite Lebanon questions with one line about Iraq.

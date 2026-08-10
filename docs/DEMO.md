# Running the demo

A loaded account for showing the product to schools, investors or parents.

```bash
docker compose up -d
npm run db:deploy
npm run db:seed        # taxonomy + the ordinary demo accounts
npm run db:demo        # the loaded presentation account
npm run dev
```

| | |
|---|---|
| **Sign in** | `demo@bac2.local` / `DemoDay2026!` |
| **Student** | Maya Haddad — Grade 12, Life Sciences (LS), English section, Lebanon |

`npm run db:demo` is idempotent and self-contained: it deletes and rebuilds the
`LS` track and the demo user, and touches nothing else. Run it again between
rehearsals to reset the story to exactly the same numbers — the generator is
seeded, so the weak chapter, the streak and every figure come out identical
every time.

---

## What is honest about this data, and what is not

**Say this out loud in the room if anyone asks.** The taxonomy follows the shape
of the Lebanese LS programme and the questions are written at its level and in
its style, but they are **not** transcriptions of real ministry papers. Every
exam cycle is titled "(illustrative)", and the account opens with an
announcement on the dashboard saying so.

Two reasons that matters commercially. Presenting invented questions as genuine
past papers is a misrepresentation a customer will eventually discover, and
copying real papers verbatim into a repository is somebody else's copyright.
Real papers enter through the ingestion pipeline (`npm run ingest`), which
writes to the same tables — so what you are demonstrating is exactly the product
that will run on real content.

**Chat transcripts are recorded, not generated live.** With no `ANTHROPIC_API_KEY`
set, the tutor correctly refuses to answer anything, which makes for a short
demo. The five conversations in the demo account are pre-recorded, but they
carry real grounding tiers, real similarity scores and real citations to rows in
this database — the same columns a live answer writes. Set an API key and the
same screens generate live.

---

## The story, in eight minutes

The order matters. It goes from "what does the student see" to "why can you
trust it" to "what does it cost you to run".

### 1. Dashboard (90 seconds)

Open on `/dashboard`. Lead with the top card — **"Pick up where you left off"**.
One instruction, one button. The commonest reason a revision session does not
happen is a student opening an app, seeing nine subjects and fifty-five
chapters, and closing it again. The card triages: cards due first, then the
weakest chapter, then an untouched one.

Then the numbers: overall readiness, cards due, an 11-day streak, questions
answered. Scroll to the **readiness rings** — one per subject, each combining
mastery, coverage and trend. Then the **fortnight activity strip** (hover a
column) and **chapter-by-chapter**, weakest first, in red.

> The line worth saying: *every number on this screen is derived from work the
> student actually did. Nothing here is self-reported.*

### 2. Progress (45 seconds)

`/progress`. Level 11, Apprentice, the daily-goal ring at 5 of 10, and the badge
wall with locked badges showing exactly what they need. Point out that levels
are **derived on read**, not stored — a student cannot end up with a level their
work does not support.

Answer a practice question during the demo and the toast fires: **+XP**, and if
you are lucky, balloons. That is the loop.

### 3. Practice and the marking engine (2 minutes) — *the core*

Go to `/practice` → Life Sciences → **Genetic engineering** (a weak chapter).
Answer a barème question in your own words, deliberately imperfectly.

The response is the product: **marks per criterion, with an examiner's note for
each**. Not a score — a breakdown. That is what a teacher does and what a
generic chatbot does not.

Then hit **Explain this**. The conversation opens anchored to *that attempt*, so
the tutor has the student's own working, the marks it earned and the official
solution side by side.

### 4. The refusal (45 seconds) — *the trust slide*

`/chat` → **"CRISPR prime editing"**. The student asks something outside the
programme and the system says:

> *"This isn't covered by the material available for your track, so I won't
> guess at it."*

…and then names what the programme *does* cover.

> The line: *anyone can demo a chatbot that answers. Ask yourself how many can
> demo one that declines. For an exam candidate, a confident wrong answer is
> worse than no answer — so refusal is a first-class outcome here, logged with
> the similarity score that triggered it.*

### 5. Exam simulator and results (2 minutes)

`/exam-sim` → open the graded paper. **10.5 out of 12**, with the barème
breakdown per question.

Scroll to the last question: **it was not marked.** The photo was unreadable, so
it is excluded from the total, flagged for a human, and the student is told.
Make a point of this:

> *A question the marker could not mark is not a zero. It is excluded from both
> the awarded and the available total and filed for a human. An examination
> product that silently scores an unreadable answer zero is one that will
> eventually cost a student a grade.*

Also worth naming: the timer is **server-authoritative**, and barèmes are
snapshotted at composition time so later edits cannot re-mark a sat paper.

### 6. Flashcards, weak-spot mode (45 seconds)

`/flashcards` → **"Where I am weakest"**. Cards drawn from the chapters the
student's own attempts say they are worst at, not from the clock. Cards pulled
in early are labelled *ahead of schedule* — the system tells you when it is
bending its own scheduler.

### 7. Close on the admin side (30 seconds)

Sign in as `admin@bac2.local` and open `/admin/review-queue`. Generated
questions do not reach students until a human approves them. `/admin/audit`
shows every consequential action, logged.

---

## Questions you will be asked

**"Is the AI making these questions up?"**
No. Retrieval is tiered and stops at the first hit: a near-exact past question,
then chapter course material, then the student's own uploads, then an explicit
refusal. Every answer records which tier fired and the similarity that triggered
it. Generated practice problems exist, but they are written from real questions
in the same chapter, checked for duplicates, solved independently by a second
model, and are invisible to students until an administrator approves them.

**"What happens when it gets a mark wrong?"**
Every criterion carries a written justification, so a contested mark can be
reviewed by a human without re-running the model. A refusal or a malformed
response surfaces as "needs human marking", never as a zero.

**"Does it work in Arabic and French?"**
The whole interface is in all three, right-to-left included. Language is chosen
at signup and locked; changing it is an audit-logged admin action.

**"What does it cost to run?"**
Marking an open answer is the expensive call and it is rate-limited per student.
MCQ is marked by string comparison and costs nothing. The app is fully navigable
with no API key at all — it refuses rather than degrading into invented content.

**"Can we start with one school?"**
Yes. Country, track and subject are all data. Opening a second curriculum is an
ingestion job, not a release.

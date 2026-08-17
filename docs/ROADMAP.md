# Bac II — the AI work still to do, in order

Every remaining step on the AI side of the system, in the order it has to happen.
Each one unlocks the next, which is why the order is not negotiable.

As of 14 August 2026. Days are working days for one developer.

```
   ①  Embeddings          ②  Read the papers      ③  Read the books
      turn search on   →     questions + answers →   course material
      0.5 days               21 days                 6 days
                                    ↓
   ⑥  Marking          ⑤  Tutor goes live      ④  Tune the search
      calibration      ←    it can finally     ←    thresholds against
      3 days                answer · 1 day          real content · 2 days
        ↓
   ⑦  Handwriting      ⑧  Generated practice   ⑨  Difficulty
      OCR check       →     questions         →    calibration
      2 days                2 days                 1 day
                                    ↓
   ⑩  Per-part marking                    ⑪  Cost and speed tuning
      4 days                                  3 days
```

**Total: about 45 working days — 9 weeks — of AI work.** Step 2 is two thirds of it.

---

## ① Embeddings — turn the search on

**What it is.** Every piece of content gets converted into a numerical fingerprint
so the system can find the right page for a student's question. Nothing has one
yet.

**Why first.** The tutor finds material by comparing fingerprints. With none
written, nothing matches anything, so every question falls through to "the
programme does not cover this" — the tutor refuses everything, correctly and
uselessly. Nothing downstream can be tested until this is on.

**Days: 0.5** · ⛔ **Blocked on one API key.**

---

## ② Read the past papers — build the question bank

**What it is.** The AI reads 1,451 past exam papers (2004–2021, 7,472 pages) and
pulls out of each one: the questions, the official model answers, and the mark
scheme — how many points each criterion is worth. Each question is fingerprinted
as it lands.

**Why here.** This is the product's raw material. The tutor quotes from it, the
exams are built from it, the marking is judged against it. Everything after this
step is empty without it.

**Days: 21** — 5 supervised on the first paper before we trust it, 8 for the 1,382
digital papers, 3 for the 69 scanned ones through OCR, 5 of human review.

**Watch for:** the pipeline has never been run against a real scanned paper. The
first run is deliberately slow and watched.

---

## ③ Read the books — course material

**What it is.** The AI splits 38 transcribed textbooks (9,593 pages) into
self-contained explanations — a definition, a method, a worked example — each one
able to stand alone when shown to a student.

**Why here.** This is what the tutor falls back on when a student's question does
not match a past exam question. Without it the tutor can only ever answer
questions that have been asked in an exam before.

**Days: 6**

---

## ④ Tune the search thresholds

**What it is.** The tutor searches in tiers: a near-identical past question first,
then chapter course material, then the student's own uploaded notes, then an
honest refusal. Each tier has a similarity score it must clear. Those scores were
set against demo content; step 4 measures them against the real corpus and moves
them.

**Why here.** Tuned too loose, the tutor answers confidently from the wrong
chapter. Too tight, it refuses questions it could have answered. This cannot be
judged until ② and ③ have filled the corpus.

**Days: 2**

---

## ⑤ The tutor goes live

**What it is.** Nothing to build — it is already written. This is the point where
it starts working: it retrieves real material, answers from it, and a second model
checks the answer against the source before the student sees it. If the check
fails, the answer is pulled off the screen rather than shown.

**Why here.** It is the first step where the product does what it claims to do.

**Days: 1** of verification, not development.

---

## ⑥ Marking calibration

**What it is.** The marking engine is built: it marks against the official barème
criterion by criterion, writes a justification for every mark, and never gives a
zero to something it could not read — it files it for a human instead. Step 6 is
checking its marks against real teacher marks on real scripts and adjusting the
prompt until they agree.

**Why here.** It needs the real mark schemes from ② to mark against.

**Days: 3** · Needs a teacher for a day to mark the same scripts independently.

---

## ⑦ Handwriting — the answer-photo path

**What it is.** Students photograph handwritten work. The AI reads the photo,
checks its own reading is consistent before marking it, and only then marks.

**Why here.** Written and wired, never tested on real Lebanese handwriting under
exam conditions. It is the step most likely to surprise us, so it happens before
students rely on it, not during a pilot.

**Days: 2**

---

## ⑧ Generated practice questions

**What it is.** The AI writes new practice problems modelled on real questions from
the same chapter, checks they are not near-duplicates of anything we already have,
solves them independently with a second model to prove they are solvable — and
then holds them until a human approves them. Nothing a student sees is generated
and unreviewed.

**Why here.** It writes from real questions, so it needs ② finished to have
anything to imitate.

**Days: 2** · Needs someone to staff the approval queue.

---

## ⑨ Difficulty calibration

**What it is.** Question difficulty is currently a fixed default. Once students
have attempted questions, the system recomputes each question's real difficulty
from how they actually performed, which sharpens the predicted mark.

**Why last of the content steps.** It needs real students. It cannot be done before
a pilot; it is the first thing to run during one.

**Days: 1**

---

## ⑩ Per-part marking

**What it is.** A real Bac paper is exercises with numbered parts totalling 20.
Marking each part separately lets us tell a student *"you lose marks on the
'deduce' steps, not the calculations"* rather than just giving a number.

**Why here.** It changes what a mark means, so it comes after marking is calibrated
and trusted at ⑥.

**Days: 4** (the AI portion of a larger 18-day change)

⛔ **Blocked on one decision:** mark each part separately, or mark the whole
exercise in one pass and return marks per part? Twenty AI calls per paper versus
four — **a fivefold difference in what marking costs to run**, for very similar
feedback quality. The recommendation is one call per exercise.

---

## ⑪ Cost and speed tuning

**What it is.** The same work, done cheaper and faster: reusing the repeated parts
of each request instead of re-sending them, running the bulk jobs on the
half-price batch channel, and choosing a cheaper model per job where it is
defensible — splitting text, yes; marking a student's exam, no.

**Why last.** It needs real traffic to measure against. Tuning before there is
usage is guesswork.

**Days: 3**

---

## The three blockers

| Blocker | Stops | Cost of waiting |
|---|---|---|
| **One API key** | Step ① — and therefore every step | The tutor refuses every question. The product cannot be demonstrated honestly |
| **Mark per part or per exercise?** | Step ⑩ | Fivefold difference in the ongoing cost of marking |
| **A teacher for one day** | Step ⑥ | We would be shipping marks nobody has checked against a human |

Everything else on this list is work, not waiting.

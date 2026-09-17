# bac2 — system brief

A handover document for planning design work. Written 2026-09-18.

Every number here was verified against the database during the session that
produced this file, except where marked. Figures are from **production (Neon)**
unless stated.

---

## 1. What the product is

An AI tutor for the **Lebanese Baccalaureate** (Bac II) — the national
school-leaving examination. A student picks their track, and the product tutors
them, marks their work, and tells them where they stand.

The thing that makes it defensible is **not** the model. It is a corpus:
eighteen years of official past papers (2004–2024) with the ministry's own
marking schemes, plus the textbooks, ingested, chunked and embedded. The tutor
answers **only** from that corpus, and refuses when nothing clears a similarity
threshold, because a confident wrong answer to an exam candidate is worse than
"this isn't covered."

**Business model (current thinking):** direct to student, nationally. Not sold
to schools. So **cost per student per month is the business**, and answer
quality is existential — there is no teacher in the loop to catch a wrong
answer.

---

## 2. Who uses it

A 17–18 year old, on a phone, on patchy data, often late at night, a few weeks
before an exam that determines their university place.

**They are trilingual by subject, not by preference.** One Lebanese candidate
sits Arabic history, French maths and English biology off the same timetable.
This is the single most important fact for design:

- The interface has one language (the student's choice: `fr` / `en` / `ar`).
- The **content** has three, and they mix on the same screen.
- An Arabic-medium subject renders right-to-left inside a left-to-right page,
  and vice versa.
- Students commonly type Arabic in Latin letters ("arabizi": `shu ya3ne el
  isti3ara`). The tutor answers in the **subject's** language regardless,
  because that is the language they will write the exam in.

Any design that assumes one direction or one script will break.

---

## 3. Scale of the corpus

| | |
|---|---|
| Tracks | 4 — GS, LS, LH, SE |
| Subjects | 60 rows = ~18 distinct subjects × tracks × languages |
| Chapters | 1,193 |
| Questions (not rejected) | 5,783 |
| Textbook passages | ~12,700 |
| Exam papers | 18 years, 2004–2024, two sessions each |
| Questions with an official barème | 3,801 |
| Questions with an official solution | 1,277 |

**Known gaps, stated honestly:**

- **310 chapters have reading material but no exam questions.** Lebanese
  examiners set some chapters every year and others never. This is a supply
  fact, not a bug.
- **Answer quality is verified on 26 of 4,798 questions.** Nobody has
  systematically checked whether the tutor's answers are *right*. This is the
  biggest open risk in the product.
- ~7% of maths spans still fail to render (nested `$` delimiters produced by the
  ingester).

---

## 4. Stack

- **Next.js 15** (App Router), React, TypeScript
- **Tailwind**, with a token layer in `src/app/globals.css`
- **Postgres + pgvector** (HNSW indexes), Prisma 6
- **OpenAI** for generation and embeddings (provider-swappable; an Anthropic
  adapter exists behind the same interface)
- Deployed on **Vercel, via the CLI** — not GitHub integration. Pushing does
  not deploy.

Server components by default. Client components only where interaction demands
it (the chat thread, the subject picker, the print button).

---

## 5. Screens

### Student
| Route | What it is |
|---|---|
| `/dashboard` | Landing. Standing, next actions, first-steps onboarding. |
| `/chat`, `/chat/[id]` | The tutor. Subject picker, then a streaming conversation. |
| `/practice` → `/[subject]` → `/[chapter]` → `/quiz` | Past-exam questions by chapter, marked against the barème. |
| `/summaries/...` | Chapter summaries written from the textbook, cached. |
| `/flashcards`, `/flashcards/review` | SM-2 spaced repetition. |
| `/exam-sim`, `/exam-sim/new`, `.../results` | Timed mock papers. |
| `/old-cycles/...` | Browse real past papers by year. |
| `/progress`, `/performance` | Mastery, readiness, predicted mark /20. |
| `/report` | **Printable** readiness report for a parent. |
| `/worksheet` | Build a worksheet of real past questions + answer key. |
| `/schedule`, `/todos` | Revision plan. |
| `/upload`, `/settings/references` | Student's own documents (tier-3 material). |
| `/settings/*` | Profile, grades, billing. |
| `/notifications` | |

### Admin
`/admin/users`, `/admin/review-queue`, `/admin/ingestion`, `/admin/announcements`,
`/admin/audit`.

**There is no teacher role and no concept of a class.** Two roles only:
`student`, `admin`.

---

## 6. The design system as it stands

### Tokens
All in `:root` in `src/app/globals.css`, as HSL triplets consumed by Tailwind.

**Just rewarmed (2026-09-18).** It was indigo-on-lavender — correct, measured,
and cold. Now:

- **Surfaces:** warm off-white. `--paper` `40 38% 96%`, `--paper-raised` white,
  `--paper-sunken` `38 40% 95%`
- **Ink:** warm near-black, `28 20% 16%`, with `--ink-muted` and `--ink-faint`
- **Spine:** deep mint, `--primary` `168 62% 32%`. The pale friendly mint is
  `--primary-soft`, used as a ground.
- **Warm partner:** amber, `--accent` `28 70% 38%`
- **Status:** rose (`--mark`, the examiner's pen), teal (`--correct`), amber
  (`--partial`). **Never used decoratively** — a student learns their meaning in
  the first session and must be able to trust it.
- **Subject tints:** six, carrying no meaning beyond "different from the one
  above".

> **Constraint that matters for any palette change:** relative luminance is
> hue-dependent. A mint at the indigo's old lightness is much brighter and drops
> white text below WCAG AA. Every pair in that file was *computed*, and the
> ratio is written beside the token. Changing a hue means recomputing, not
> eyeballing. Dark theme exists and follows the same method.

### Primitives — `src/components/ui/`
`button`, `field`, `sheet` (card + header + body), `feedback` (alert, badge,
empty state), `band` (mark bands), `progress` (meter), `charts`, `math`
(LaTeX via KaTeX), `back-link`, `motion`, `page-skeleton`.

### Type scale
`micro` 11px, `caption` 12px, `meta` 13px, then body sizes. Dense by design —
this is a study tool, not a marketing site.

### Motion
**Deliberately minimal.** `float`, `wiggle` and `pulse-slow` are resolved to
`none` in `tailwind.config.ts`. Ambient motion was removed from this codebase on
purpose; a mascot that blinks at a student reading a mark scheme is putting it
back. Any animation must correspond to something actually happening.

---

## 7. The tutor's character

- Rendered by `src/components/chat/tutor-avatar.tsx` — an SVG face with a
  mortarboard. Three moods, each driven by **real state**, never a timer:
  `idle` (nothing happening), `thinking` (a request is genuinely in flight),
  `attentive` (the page has handed it something to look at).
- Drawn at **22px** far more often than larger. Detail must survive that.
- There is a default name — **Nour** — and the student can rename it. The dock
  currently shows the literal word "Tutor" instead, which is part of why it
  feels impersonal.

**The identity is not designed.** The competitor (`tawjihiai`) has a mascot
called زكي (Zaki) with a name, a colour and a personality, and that does most of
the warmth in their product. Deciding who this tutor *is* — name, character,
voice — is the open design question and the owner has not made that call yet.

---

## 8. Voice

The rule adopted for copy: **say what the student can do, in the voice of
someone sitting beside them; never name our machinery.**

Before → after, as a calibration sample:
- "Nothing anchored — this starts a fresh conversation." → "Nothing on this
  screen to look at — ask me anything you like."
- "Reported. An administrator will review it." → "Thanks — flagged. Someone
  will take a look."

Much of the product still reads like a status report. **Empty states are the
worst offenders** and are where the product feels most robotic.

The product also never overclaims: a subject with too little marked work prints
"not enough marked work yet" rather than a number, and an ungrounded answer is
labelled as such. That honesty is a design constraint, not a bug to smooth over.

---

## 9. What is weakest, design-wise

Named plainly, in the owner's own words: *"no organization, icons, colors —
trivial UI."* Specifically:

1. **No identity.** No mascot name, no character, no voice of its own.
2. **Empty states** read like system messages.
3. **Density without hierarchy** on the data-heavy screens (progress,
   performance, dashboard).
4. **Mixed-script layout** is functional but visually ragged wherever Arabic and
   Latin subjects sit in the same list.
5. **Mobile** has had far less attention than desktop, and the real user is on a
   phone.

---

## 10. Non-negotiables for any redesign

1. **WCAG AA.** Every text/surface pair is currently measured and documented.
   Keep that.
2. **Three languages, both directions**, mixing on one screen. `dir` belongs on
   the text that has a direction, not on the layout around it.
3. **Status colours keep their meanings.** Rose/teal/amber mean lost marks,
   correct, partial. Never decorative.
4. **No ambient motion.**
5. **Honesty over polish.** The product refuses, labels, and says "not enough
   data" where that is true. A design that hides those states breaks the thing
   that makes it trustworthy to an exam candidate.
6. **Dark theme** must move with any palette change.

---

## 11. Useful files

| Path | |
|---|---|
| `src/app/globals.css` | All design tokens, with contrast ratios documented |
| `tailwind.config.ts` | Type scale, radii, the motion opt-out |
| `src/components/ui/` | Every primitive |
| `src/components/chat/tutor-avatar.tsx` | The face |
| `src/lib/i18n/dictionaries/{en,fr,ar}.ts` | All copy, three files |
| `src/lib/subject-icon.ts` | Subject → icon mapping |
| `LAUNCH-PLAN.md` | Outstanding work and rules learned |

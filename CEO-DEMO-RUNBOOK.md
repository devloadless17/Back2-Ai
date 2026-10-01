# CEO product demo runbook

## The message

Loadless is a Lebanese Baccalaureate study system that connects the official curriculum, real past papers, grounded tutoring, exam practice, marking, and readiness tracking in one student workflow. The strongest proof is traceability: the student can see the chapter, paper, passage, figure, marking scheme, and resulting progress rather than receiving an unsupported generic answer.

## Before the meeting

- Open production in Chrome and sign in before screen sharing.
- Use a student account with LS, GS, LH, or SE already selected and with existing attempts.
- Keep these pages open in separate tabs: Dashboard, one subject, one clean 2024 past paper, one completed exam result, Progress, and Admin content monitor.
- Set browser zoom to 90% or 100% and close unrelated tabs and notifications.
- Confirm the interface language and paper language you want to demonstrate.
- Do not start a paid AI generation during the meeting. Demonstrate an existing grounded tutor conversation and cached/generated study material instead.
- Keep this runbook open on a second device.

## 15-minute walkthrough

### 1. Dashboard — 90 seconds

Open `/dashboard`.

Say: “This is not a content library. It tells a Bac student what to do next, based on their section, exam date, completed work, and weak chapters.”

Show:

- Bac countdown and section-specific subjects.
- Predicted mark out of 20.
- Due flashcards and the next recommended task.
- Weakest chapter or the evidence gate when there is not enough marked work.

### 2. One subject as the centre of study — 2 minutes

Open `/practice`, then Mathematics or Life Sciences.

Say: “The student chooses the subject once. Chapters, summaries, practice, past papers, flashcards, worksheets, and exam simulation stay scoped to that subject and their own section.”

Show:

- Correct curriculum chapters for the selected track.
- A chapter with textbook-backed summary and past-exam questions.
- A question containing mathematics or a scientific figure.
- The official solution or marking criteria.

### 3. Grounded tutor — 2 minutes

Open an existing conversation under `/chat`.

Say: “Zaki answers from the student’s book or the exact exam passage. It preserves literal definitions for history and philosophy, reads uploaded exercises, and tells the student when evidence is missing.”

Show:

- Source or grounding state.
- A worked mathematical answer rendered with LaTeX.
- A document-dependent biology or humanities answer.
- The report-a-problem control.

Avoid sending a new prompt unless the production AI connection has been deliberately enabled for this demonstration.

### 4. Past papers and worksheet — 2 minutes

From the subject page, open a 2024 past paper and `/worksheet`.

Say: “The paper viewer preserves equations, tables, passages, figures, and official solutions. Worksheets follow the official structure of the subject and section, preferring a complete 2024 paper.”

Show:

- Clean official section numbering.
- Rendered equations and solution LaTeX.
- A figure or table attached to its question.
- English/French/Arabic comprehension without unrelated writing prompts.
- A worksheet with no arbitrary question-count field.

### 5. Exam simulation and marking — 3 minutes

Open `/exam-sim`, then a previously completed result.

Say: “A student can sit a real paper or a structured mock. The timer is server-based, answers autosave before navigation, submission is idempotent, and failed marking jobs can recover without charging twice.”

Show:

- Real-paper and mock-paper choices.
- Subject-specific duration.
- A completed paper marked criterion by criterion.
- Awarded marks, missing points, official answer, and total out of 20.
- Optional-choice papers capped correctly at the official total.

Do not start an AI-generated paper during the meeting; use an existing completed result.

### 6. Progress and planning — 2 minutes

Open `/progress`, `/settings/grades`, and `/schedule`.

Say: “Practice evidence turns into a readiness picture and a concrete plan. School grades, exam attempts, chapter mastery, and recurring losses remain distinguishable.”

Show:

- Predicted Bac standing and evidence behind it.
- Subject/chapter coverage.
- Recurring lost marks with the student answer beside the official answer.
- School grade log.
- Weekly study schedule.

### 7. Quality and operations — 90 seconds

Open `/admin/content-monitor`, then the review queue.

Say: “Content quality is visible operationally. Broken OCR, missing passages, foreign covers, missing answers, and incomplete figures are detected before they silently reach students.”

Show:

- Content-monitor findings and direct repair links.
- Review queue and audit trail.
- Exam timing controls and announcements if time permits.

## Feature coverage checklist

- Authentication, locked track, and language selection
- Trilingual interface and paper-language rendering
- Track-specific Lebanese curriculum
- Chapter summaries and textbook sources
- Past-paper archive
- Mathematical LaTeX, tables, passages, and figures
- Grounded tutor and photo upload
- Practice questions and quizzes
- Automatic flashcards from books and exams
- Exam-structured worksheets
- Real and mock exam simulation
- Server timer and answer autosave
- Criterion-based marking and recovery
- Grades, progress, predicted standing, and reports
- Study schedule and notifications
- Content monitor, review queue, users, ingestion, timing, announcements, and audit log

## Questions the CEO may ask

**What is defensible about the AI?**  Answers are scoped to the student’s curriculum and carry their source context. The system withdraws or flags an answer when required evidence is absent.

**What makes this Lebanese rather than generic?**  Four official sections, subject editions and languages, papers marked out of 20, official choice structures, ministry-style marking schemes, and the actual curriculum taxonomy.

**How do we control cost?**  Real questions, stored embeddings, cached material, deterministic routing, idempotent marking, and retryable jobs reduce unnecessary model calls. Many visible workflows—including papers, worksheets, summaries already stored, flashcard review, scheduling, and progress—need no live generation.

**How do we know content is safe to show?**  Student-facing selection excludes rejected items, missing required passages and figures, unusable French imports, and structurally broken OCR. The admin monitor exposes remaining content gaps.

**What should launch prove first?**  Students return because the system gives them the right next task, helps them understand real questions, and converts their work into a credible view of readiness.

## Recovery plan

- If the tutor is unavailable, open the prepared existing conversation and explain its source traceability.
- If a page is slow, switch to the already-open tab rather than waiting during screen share.
- If an answer key is absent, turn on “with answer key” and rebuild the worksheet; that mode selects only complete marked material.
- If production authentication expires, keep a second signed-in browser profile ready.
- If screen sharing fails, use the prepared tabs on the meeting computer and narrate the same sequence.

## Closing line

“Loadless turns the Lebanese Bac from a pile of books and papers into a traceable daily system: learn the right material, practise the real standard, understand every lost mark, and know what to do next.”

# Bac II Exam-Prep App — System Architecture & Prompt Spec (v3)

v3 resolves the two issues left open in v2: quiz generation contradicting the
approval gate, and Photo Q&A still generating ungated. Everything else from v2
stands.

Locked decisions (from planning session):

| # | Area | Decision |
|---|---|---|
| 1 | Weakness engine | Tag-based (skill/chapter tags per question) |
| 2 | Onboarding | Single step-by-step wizard, one field per screen, motivational copy |
| 3 | Dashboard | Split hero — fixed "Today" card + Khan-style colour-coded mastery grid |
| 4 | Quiz / Flashcard / Exam-sim | Separate engines (SM-2 flashcards, quick/random quiz, timed barème exam-sim) |
| 5 | Photo Q&A | Answer + inline "want 3 similar practice questions?" follow-up |
| 6 | Exam correction | Cached hover-explanation, generated once at grading time, + scoped follow-up chat thread per error |
| 7 | Planner | Auto-adaptive, day-by-day, reweighted after every quiz/exam result |

---

## 1a. What's already built — don't rebuild this

| Item | Status |
|---|---|
| Chapter taxonomy | Built — 577 chapters derived from 38 CRDP textbooks with page provenance. What's needed is a **skill layer beneath chapter**, not a taxonomy from scratch. |
| `attempts` | Exists, drives mastery today. |
| `weakness_scores` | Exists as **recency- and difficulty-weighted mastery**, 14-day half-life. Plain success-rate is a regression. Thresholds: 0.7 ceiling, 5-attempt minimum. |
| Exam-sim content | 1,451 real past papers, 459 with official barèmes. Use these — never author synthetic exams. |
| Photo Q&A | Exists, with an OCR self-consistency gate **and** the tiered retrieval path. New prompt work sits on both. |
| Onboarding fields | Signup captures country/section/language and **locks section and language**. The wizard is a UX layer over the existing fields and lock behaviour. |
| `memory.uploaded_documents[]` | Exists as tier-3 personal retrieval. |
| Retrieval + verification | Tiered retrieval decides what may be said *before* generation. Synthesised answers get a second-model check that withdraws the answer if it fails against its source. |

**Genuinely new:** the planner, the cached hover-explanation pattern, the scoped
per-error follow-up thread, and the skill layer beneath chapter.

## 1b. Branch codes — use the current set

The wizard's section step uses **GS, LS, SE, LH**. The French initialisms
(SG/SV/VSE) were removed because having both live produced two parallel
curricula under overlapping names; `db:prune` exists to migrate rows still
carrying them.

## 1c. Data model

All tables below exist except `planner_tasks`.

### `skill_tags` (extend, don't recreate)
Chapter level already exists (577 rows, CRDP-sourced, page provenance). Add a
skill layer beneath it:
```
id, subject, chapter_id (fk → existing chapter), skill_name, syllabus_ref,
page_range (inherited from parent chapter)
```
**`page_range` is not optional.** Provenance is what makes a citation checkable
back to a real book page. A skill tag that cannot point at a page breaks the
grounding claim for everything generated against it.

### `attempts` (existing)
```
id, user_id, skill_tag_id, source_type (quiz|flashcard|exam_sim|photo_qa|followup),
question_text, student_answer, is_correct, timestamp
```

### `weakness_scores` (existing — do not replace with plain success-rate)
```
user_id, skill_tag_id, mastery_score (recency + difficulty weighted, 14-day half-life),
attempt_count, last_updated, status
```
Status follows the existing 0.7 ceiling / 5-attempt minimum.

### `question_bank` (generated content, pre-approved)
```
id, skill_tag_id, kind (quiz|flashcard), payload_json, source_passage_id,
status (pending_approval|approved|rejected), approved_by, approved_at
```

### `planner_tasks` (new)
```
id, user_id, date, task_type, skill_tag_id (nullable), title, done, auto_generated
```

### `memory` (per-user context injected per request)
```
user_id, grade_section (locked), language (locked), country, exam_date,
uploaded_documents[], weakness_summary, recent_activity_summary
```
`memory` is volatile per user — it goes in the **user turn**, never in the
cached system prompt.

---

## 2. Feature flows

### Onboarding wizard
No model call — motivational copy is pre-written per language (cheaper, more
consistent, avoids awkward generated encouragement). Steps: name → grade/section
(GS/LS/SE/LH) → language (Ar/Fr/En) → country → subject focus → done. Section and
language lock at the end, matching existing signup behaviour.

### Dashboard
No live model call on page load. Reads `weakness_scores` + today's
`planner_tasks`. The mastery grid is `weakness_scores` rendered as coloured
tiles. Keep it fast.

### Upload past grades/exams → weakness detection
The one upload-triggered call that seeds everything. **Prompt 1**.

### Quiz and flashcards — bank first, selection at request time
**Nothing is generated when a student clicks.** Generation is a background job
per skill_tag that fills `question_bank` and lands in `pending_approval`; an
admin approves once; the student's quiz is then a *selection* from approved rows
filtered by their weak tags.

This is the fix for v2's contradiction — a student cannot wait on admin review,
and serving unapproved content breaks the grounding rule. Inverting it makes
review a throughput problem you can staff rather than a latency wall in front of
a core feature, and it puts generation back on the batch channel where it
belongs.

**Prompts 2a/2b** run as background jobs, not request handlers.

### Exam simulation — assembly, not generation
Selects from the 1,451 real past papers, filtered by subject and weighted toward
the student's weak tags. No authoring of questions or barèmes. See **2c**.

### Photo Q&A
Routes through the same retrieval and verification path as the tutor — it does
not answer from the model's own knowledge. See **Prompt 3**.

### Exam correction + cached hover-explain + follow-up thread
Grading once, explanations generated once per error and cached. **Prompt 4**,
then **Prompt 5** only if the student clicks "ask more".

### Planner re-weighting
Runs on session complete, not per answer. **Prompt 6**.

---

## 3. Prompt templates

System prompts are stable per feature — cache them. Only the user turn varies.

### Prompt 1 — Extract weaknesses from an uploaded grade/exam

```
SYSTEM:
You are an academic diagnostic assistant for a Lebanese Bac II exam-prep platform.
You will be given the text/OCR output of a student's past exam or report card,
plus their profile. Identify, per question or per grade line, which skill_tag
from the provided taxonomy it maps to, and whether performance on it indicates
a strength or weakness.

Output ONLY valid JSON, no preamble:
{
  "extracted_items": [
    { "skill_tag": "...", "evidence": "...", "performance": "weak|ok|strong|unclear" }
  ],
  "summary": "2-3 sentence plain-language summary for the student"
}

Rules:
- Only use skill_tags present in the provided taxonomy list. Never invent one.
- If a document is illegible or ambiguous, mark that item "unclear" rather than
  guessing.

USER:
Student profile: {memory}
Taxonomy (scoped to this student's branch and subjects only): {scoped_skill_tags}
Document content: {ocr_extracted_text}
```

> **Scope the taxonomy.** With 577 chapters plus a skill layer, injecting the
> full list on every upload is large and hurts accuracy as much as cost. Filter
> to the student's branch and subjects before injecting.

---

**Grounding and approval — applies to 2a and 2b.** Both take retrieved source
passages as input, not bare tag names. Both cite the passage supporting each
item. Both write to `question_bank` as `pending_approval`; nothing reaches a
student until approved.

### Prompt 2a — Generate quiz questions (background bank job)

```
SYSTEM:
Generate {n} multiple-choice questions for a Lebanese Bac II student, grounded
strictly in the retrieved source passages provided. Every question and its
correct answer must be traceable to a specific passage — cite the passage id
supporting each. Do not introduce facts, figures or claims absent from the
retrieved material. Match the syllabus level exactly.

Output ONLY valid JSON:
{ "questions": [{ "skill_tag": "...", "source_passage_id": "...", "question": "...",
  "options": [...], "correct_index": 0, "explanation": "..." }] }

These are drafts for the question bank. They enter pending_approval and are not
shown to students until an admin approves them.

USER:
Skill tag: {skill_tag}
Retrieved source passages: {retrieved_passages}
Subject: {subject}
Language: {language}
Count: {n}
```

### Prompt 2b — Generate flashcards (background bank job)

```
SYSTEM:
Generate {n} flashcards (front/back) for spaced repetition, grounded strictly in
the retrieved source passages provided. Cite the source passage id for each card.
Fronts are a concise prompt or term; backs are a complete but brief answer a
student can self-grade against.

Output ONLY valid JSON:
{ "flashcards": [{ "skill_tag": "...", "source_passage_id": "...",
  "front": "...", "back": "..." }] }

These are drafts. They enter pending_approval and are not shown to students
until an admin approves them.

USER:
Skill tag: {skill_tag}
Retrieved source passages: {retrieved_passages}
Language: {language}
```

### Prompt 2c — Exam simulation: assembly, not generation

No generation prompt. Exam-sim selects from the bank of 1,451 real past papers,
filtered by subject and weighted toward the student's weak skill_tags. Any model
involvement is a light selection or summarisation pass over already-real
content — never authoring questions or barèmes.

### Prompt 3 — Photo Q&A (through retrieval, not around it)

Retrieval runs **before** this prompt and decides what may be said. If nothing
clears a tier, the student gets an honest "the programme doesn't cover this"
rather than a generated answer. Tier 2/3 answers go through the verification
pass and are withdrawn if the check fails.

```
SYSTEM:
A student has uploaded a photo of a problem they are stuck on. Answer step by
step at their grade level, using ONLY the retrieved source material provided.
Cite the passage id supporting each step. If the retrieved material does not
cover what the question asks, say so plainly and name what the programme does
cover — do not answer from your own knowledge.

Identify which skill_tag the question belongs to, from the taxonomy given.
Then offer similar practice questions.

Output ONLY valid JSON:
{ "skill_tag": "...", "answer": "...", "source_passage_ids": [...],
  "covered": true, "offer_practice": true }

USER:
Student profile: {memory}
Retrieved source passages: {retrieved_passages}
Taxonomy (scoped): {scoped_skill_tags}
Image content (OCR/vision extracted): {extracted_problem_text}
```

The practice questions offered come from the approved `question_bank` for that
skill_tag — they are selected, not generated on the spot.

### Prompt 4 — Grade a submission + generate cached explanations

Three invariants hold **server-side**, not by prompt instruction alone:

1. `points_awarded` is clamped to `points_possible` on receipt, whatever the
   model returns.
2. A result missing `justification` is rejected.
3. A parse failure or missing field routes to `needs_human_marking` — never a
   zero, never a silent default.

```
SYSTEM:
Grade the student's submitted answers against the model answers and barème.
For every criterion you MUST provide a written justification — points without
justification are rejected downstream. Never award more than a criterion's
stated maximum. If an answer or criterion is ambiguous, illegible or
unscoreable, mark it "needs_human_marking" rather than guessing or defaulting
to zero.

For every incorrect or partially correct answer, also write ONE cached
explanation (shown on hover — 2-4 sentences, plain, in the student's language)
covering what was wrong and the correct reasoning. Tag each error with its
skill_tag so it feeds the weakness engine.

Output ONLY valid JSON:
{ "results": [{ "question_id": "...", "skill_tag": "...",
  "points_awarded": ..., "points_possible": ..., "justification": "...",
  "needs_human_marking": false, "is_error": true, "cached_explanation": "..." }] }

USER:
Exam: {exam_json}
Student submitted answers: {submitted_answers}
Language: {language}
```

### Prompt 5 — Follow-up thread on one error

```
SYSTEM:
The student is asking a follow-up about a specific exam error they have already
seen an explanation for. Stay scoped to this one question. Do not re-explain the
whole exam. Be direct and patient.

End your reply with a JSON line recording the exchange:
{ "skill_tag": "...", "resolved": true|false }

USER:
Original question: {question_text}
Student's wrong answer: {student_answer}
Correct answer: {correct_answer}
Cached explanation already shown: {cached_explanation}
Student's follow-up: {student_followup_message}
```

> The trailing JSON exists so follow-ups feed the weakness engine. A student
> asking three follow-ups on one error is a strong weakness signal; without this
> it is dropped. Write it to `attempts` with `source_type = followup`.

### Prompt 6 — Planner re-weighting (on session complete)

```
SYSTEM:
Update the student's day-by-day study plan between now and their exam date,
weighting time toward weak and developing skill_tags and away from mastered
ones. Keep it realistic — never more than {max_daily_minutes} minutes a day.
Preserve any task the student has pinned.

Output ONLY valid JSON:
{ "planner_tasks": [{ "date": "...", "skill_tag": "...", "task_type": "...",
  "title": "...", "est_minutes": ... }] }

USER:
Exam date: {exam_date}
Current weakness_scores: {weakness_scores}
Pinned tasks (do not remove): {pinned_tasks}
Days remaining: {days_remaining}
```

---

## 4. Cost control

- **Prompt caching** — system prompts are stable per feature. Cache them; only
  the user turn changes. `memory` is volatile and belongs in the user turn, after
  the cache breakpoint.
- **Batch channel** — Prompt 1, and now 2a and 2b, are background jobs and not
  latency-sensitive. All three run at half price. Moving quiz generation off the
  request path is what makes this possible.
- **Prompt 4 explanations are generated once.** Stored on the result row, never
  regenerated on hover.
- **Prompt 6 runs on session complete**, not per answer.
- **Approval throughput is now a planning input, not a blocker.** The bank is
  seeded and approved ahead of release; students select from it.

---

## 5. Open items

- **Skill layer beneath chapter** — still the prerequisite for 2a/2b to retrieve
  meaningfully. Smaller than a taxonomy from zero: 577 chapters exist with
  provenance, and the skill layer inherits their page ranges.
- **Retrieval tier for 2a/2b** — confirm whether bank generation pulls from
  tier 1 (past questions) or tier 2 (course material), or both.
- **Corpus gaps for exam-sim assembly** — 459 of 1,451 papers carry an official
  barème, and papers exist for 15 of 18 years (2010, 2014 and 2020 are absent
  entirely). Decide how assembly handles a subject-year with a paper but no
  barème, and with no paper at all.
- **Approval staffing** — how many skill_tags need an approved bank before
  launch, and who reviews them.
- **Model tier per prompt** — a build-time decision once cost testing starts.

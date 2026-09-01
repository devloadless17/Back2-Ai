# Route by question type

Retrieval sends every question down one path: find the chapter, hand over its
passages. That is right for a concept question and wrong for the other two kinds
the Lebanese Bac asks, and the cost is measurable — French, English and Arabic
literature all score poorly, and they drag every average that includes them.

## The three kinds

**Concept.** "ما هي البطالة؟", "Explain the photoelectric effect." The answer is
in the textbook. Chapter retrieval works: 0.83 lift in Arabic, 0.81 French.
Leave this path alone.

**Comprehension.** "Quel est le mot qui, par ses répétitions, souligne le thème ?"
The answer is in a passage printed on the exam paper, not in any chapter. No
amount of retrieval quality can help; the chapter does not contain it. GS
Français scores 0.04 lift — at chance — almost entirely because of these.

**Essay prompt.** "Sujet : Partagez-vous le point de vue…", "اشرح هذا القول".
There is no fact to retrieve. What helps is the shape of a good answer: the
marking scheme's expected structure.

## What to build

1. **A classifier.** Mostly rules, no model needed for the first cut:
   - `Sujet :` / `الموضوع` / an instruction verb with no document reference -> essay
   - a reference to a document, text or line number ("le texte", "المستند", "l.12")
     -> comprehension
   - otherwise -> concept

2. **Three paths in `retrieveGrounding`:**
   - concept -> today's chapter search, unchanged
   - comprehension -> the paper's own passage. `extract_exams.py` already reads
     it and throws it away; it needs storing on the question.
   - essay -> the barème and, where we have it, the official solution's
     structure. Philosophy now has 51 of these; 1,082 questions have a barème.

3. **Style grounding on the ANSWER side.** This is the part that is missing
   today and the reason a correct answer still reads like a chatbot. Lebanese
   markers award per step, and the barème states the steps. Feeding it into the
   answer prompt is what makes the tutor answer the way the examiner marks.

## Measure it with

    npm run bench:retrieval

Route each kind separately and report separately. A comprehension question
scored against chapter retrieval is measuring the wrong thing, which is what
today's numbers do.

## Where to be careful

Do not let the classifier fall back to concept retrieval for a comprehension
question it is unsure about. Answering from the wrong chapter is what the tier
system exists to prevent, and it is invisible when it happens.

## What is built, and what it measured

The classifier is `src/lib/question-kind.ts`; the three paths are in
`retrieveGrounding`; the answer-side barème instruction is in `systemPrompt`.
Numbers below are from `npm run bench:retrieval`, which now routes and reports
each kind separately.

**The corpus is not mostly concept questions.** Of 2,299 past-exam probes:
47% concept, 30% comprehension, 23% essay. Every one of those comprehension
probes was previously scored — and answered — against a chapter.

**Concept retrieval was being under-reported by the mixing.** Taking the other
two kinds out of the average, without changing chapter retrieval at all — both
columns from the same run, so the difference is the routing and nothing else:

              all kinds   concept only
    ar          0.80          0.87
    fr          0.83          0.87
    en          0.77          0.79
    GS          0.70          0.75

The all-kinds column is what this benchmark reported before, and it still prints
it, so the two can be read side by side rather than taken on trust.

GS Français no longer appears in the concept table, because none of its
questions are concept questions. Its 0.04 was never a retrieval failure; it was
eight comprehension questions being asked of a chapter index.

**The essay path reaches a marking scheme for 67% of essay probes** — 100% in
philosophy, French, sociology and economics, which is where the schemes are, and
0–25% in Arabic, English, civics and geography, which hold almost none.

Getting there took a corpus fix as well as the code. 1,067 of the 1,714
questions carrying a scheme had no embedding and so could not be found by any
search in the system: `load-exams.ts` clears the vector when re-extraction
improves a statement, which is right, and nothing said the rows were then
invisible until `npm run ingest -- --embed-missing` ran. LS Philosophie held 78
barèmes and 4 embeddings and read as a subject with none. The backfill is done —
all 5,254 questions are embedded — and the loader now reports what it left
unsearchable, the way `load-chunks.ts` always has.

One extraction limit remains, and it is not a routing problem: where the parser
could not read a marking table, the barème rows it stored are the questions with
their marks against them rather than the steps. That still carries the 9/7/4
split a Lebanese philosophy paper is marked on, which is most of what the answer
prompt needs, but it is not the step list.

## Still to do

The comprehension path currently answers only when the passage arrives with the
question — pasted, photographed, or attached to the question being worked on —
and asks for it otherwise, which is at least honest. Storing the passage
`extract_exams.py` already reads would let it answer from the paper itself. That
is the remaining half of point 2.

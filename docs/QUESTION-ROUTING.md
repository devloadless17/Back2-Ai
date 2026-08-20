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

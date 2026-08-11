# Real exercises and sub-questions — design for discussion

**Decision taken: Option B.** A paper becomes exercises containing parts, each
part marked and reported on its own. Nothing below is built yet; this is the
proposal to argue with before anything is migrated.

---

## What a real paper looks like

A Lebanese Bac paper is not a flat list of questions. It is three or four
**exercises**, each carrying its own mark allocation, and each containing an
introductory text or document followed by numbered **parts**:

```
Premier exercice (7 points)          ← exercise: context + points
  Un document présente …             ← the énoncé, shared by every part
  1.  Nommer les cellules …          (1 pt)   ← part
  2.  Expliquer pourquoi …           (2 pts)  ← part
  3.a Déterminer la concentration …  (2 pts)  ← part
  3.b En déduire …                   (2 pts)  ← part

Deuxième exercice (6 points)
  …
                                     Total: 20
```

Two properties matter and neither survives a flat model:

* **The énoncé is shared.** Part 3.b is meaningless without the document at the
  top and usually without part 3.a. Anything that shows a part alone — practice,
  a flashcard, the tutor — has to carry the exercise with it.
* **Marks are allocated per part**, and the parts sum to the exercise, and the
  exercises sum to 20.

---

## The schema change

```prisma
model Question {
  // … existing fields

  /// Set on a part; null on an exercise and on a standalone question.
  parentId   String?  @map("parent_id") @db.Uuid
  /// "1", "2", "3.a" — printed as the book prints it, not generated.
  partLabel  String?  @map("part_label")
  /// Marks for this part. An exercise's total is the sum of its parts.
  points     Decimal? @db.Decimal(4, 2)

  parent Question?  @relation("QuestionParts", fields: [parentId], references: [id], onDelete: Cascade)
  parts  Question[] @relation("QuestionParts")

  @@index([parentId, partLabel])
}
```

Three shapes then coexist, and everything must keep working with all three:

| Shape | `parentId` | `parts` | Meaning |
|---|---|---|---|
| Standalone question | null | empty | What exists today. Unchanged |
| Exercise | null | non-empty | Carries the énoncé and the shared context |
| Part | set | empty | Carries its own barème and marks |

**Back-compatibility is the point of that table.** Every question in the
database today becomes a standalone question and nothing about it changes. The
migration adds three nullable columns and touches no existing row.

---

## What changes, and where

| Area | Change |
|---|---|
| **Composition** (`lib/exam.ts`) | A real-cycle paper selects exercises, then expands their parts in `partLabel` order. `maxScore` sums the parts |
| **Marking** (`lib/grading.ts`) | Each part is marked against its own barème, but the model is given the **exercise énoncé plus the earlier parts** as context. Marking 3.b without 3.a produces nonsense |
| **Results page** | Three levels: exercise → part → criterion. The criterion explanation built this week stays as the innermost layer |
| **Mastery** | Attributed per part, so a student who loses marks only on "deduce" parts can be told that |
| **Flashcards** | A card is a part, and must render its exercise context |
| **Tutor** | Anchoring to an attempt must pull the whole exercise, not just the part |
| **Ingestion** | The parser has to detect part numbering. This is the hard one |

---

## The three risks

**1. Marking cost multiplies.** Today a four-question paper is four model calls.
Four exercises of five parts each is **twenty** — five times the cost and five
times the latency, per paper. The attempt rate limit (60/hour) was sized for
flat questions and would now be consumed five times faster.

*Options:* mark a whole exercise in one call and have the model return marks per
part (one call, cheaper, slightly worse attribution); or mark per part and raise
the limit. **This needs a decision.**

**2. Which chapter does a part belong to?** Real exercises span topics — a
genetics exercise can end with a statistics part. `Question.chapterId` is
currently required. Either the part carries its own chapter (accurate, more
ingestion work) or parts inherit the exercise's (simpler, wrong sometimes).
Mastery accuracy depends on this.

**3. Ingestion has to find the parts.** Detecting "3.a" versus a numbered list
inside a paragraph is exactly the kind of thing the TOC parser already gets
wrong on some books. Expect a review pass per paper, as with the chapter lists.

---

## Questions for you

1. **Mark per part, or mark the exercise in one call?** Cost versus attribution.
   My recommendation: one call per exercise returning marks per part — same
   feedback quality, a fifth of the cost.
2. **Do parts carry their own chapter?** My recommendation: yes, with the
   exercise's chapter as the default when ingestion cannot tell.
3. **Do papers have to total 20?** If yes, composition should refuse to build a
   paper that does not, rather than quietly producing one marked out of 17.
4. **Practice mode: whole exercises, or single parts?** A part is quicker and
   fits a ten-minute session; an exercise is what the exam actually asks for.
5. **Do old flat questions get migrated into exercises**, or left as they are?
   Leaving them is free; converting them is manual work per paper.

---

## Suggested order of work

1. Migration — three nullable columns, no data change *(safe, reversible)*
2. Composition and display — papers render as exercises with parts
3. Marking — whichever of the two shapes question 1 settles
4. Mastery, flashcards, tutor context
5. Ingestion — part detection, with a review surface

Steps 1 and 2 are safe to do before the questions above are answered. Step 3 is
not: it changes what a mark means, and it is the step to discuss first.

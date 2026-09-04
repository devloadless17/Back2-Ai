-- Which chapter a mark belongs to.
--
-- Mastery used to be counted by joining back to the question's own chapter,
-- which was the same thing right up until a chapter began offering exercises
-- filed elsewhere. A GS student practising alcohols now answers LS exercises on
-- alcohols; crediting the question's home would post their marks to the other
-- track's chapter, where their progress page never looks.
--
-- Nullable, and null means "the question's own chapter" — so nothing has to be
-- rewritten before this is safe to deploy, and an attempt whose chapter is later
-- deleted degrades to the old behaviour rather than vanishing from mastery.
ALTER TABLE attempts ADD COLUMN chapter_id uuid;

ALTER TABLE attempts
  ADD CONSTRAINT attempts_chapter_id_fkey FOREIGN KEY (chapter_id)
  REFERENCES chapters(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX attempts_chapter_id_idx ON attempts (chapter_id);

-- Backfill to exactly what mastery counted before, so no student's history
-- moves as a result of this migration.
UPDATE attempts a
   SET chapter_id = q.chapter_id
  FROM questions q
 WHERE a.question_id = q.id AND a.chapter_id IS NULL;

UPDATE attempts a
   SET chapter_id = g.chapter_id
  FROM generated_problems g
 WHERE a.generated_problem_id = g.id AND a.chapter_id IS NULL;

-- Which criteria a practice answer actually earned.
--
-- The marker has always produced this. `gradeAgainstBareme` returns a result
-- per criterion — points awarded, points possible, and a written justification
-- — the API hands it to the browser, the student reads it once, and the attempt
-- row keeps only the total. Every detail of WHY a mark was lost has been
-- discarded at the moment it was computed.
--
-- That detail is the difference between "you scored 11/20 in this chapter" and
-- "you have now lost marks three times for not stating the problematic". The
-- second is the thing a student can act on, and it cannot be reconstructed from
-- a total.
--
-- Shape matches `exam_answers.bareme_result`, deliberately, so one reader
-- serves both:
--   [{ criterion, points_awarded, points_possible, justification, explanation }]
--
-- NULL for every row written before today, and for MCQ attempts, which are
-- marked objectively and have no criteria. Null means "no criterion detail",
-- never "scored zero on everything" — anything reading this must skip nulls
-- rather than counting them as failures.
--
-- Not backfilled. Re-marking 153 historical attempts would cost a model call
-- each and invent a past that was never recorded; the feature starts from here.
ALTER TABLE "attempts"
  ADD COLUMN "bareme_result" JSONB;

COMMENT ON COLUMN "attempts"."bareme_result" IS
  'Per-criterion marking of a practice answer. Same shape as exam_answers.bareme_result. NULL = not marked against criteria.';

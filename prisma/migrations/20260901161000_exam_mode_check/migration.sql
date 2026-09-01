-- Teach the mode/cycle check about the third mode.
--
-- `exam_simulations_cycle_matches_mode` enumerated the two modes that existed
-- when it was written: real_cycle must name a paper, ai_generated must not.
-- An assembled paper names no cycle either — it draws from many — so inserting
-- one failed the check outright. Caught by the database on the first attempt,
-- which is exactly what a constraint like this is for.
--
-- Rewritten so the rule is stated once rather than per mode: naming a paper is
-- what `real_cycle` means, and no other mode may. A fourth mode added later
-- inherits the right behaviour instead of hitting this again.
--
-- Its own migration because Postgres will not let a value added to an enum be
-- used in the same transaction that adds it, and the previous migration is what
-- added `real_mixed`.
ALTER TABLE "exam_simulations" DROP CONSTRAINT "exam_simulations_cycle_matches_mode";

ALTER TABLE "exam_simulations"
  ADD CONSTRAINT "exam_simulations_cycle_matches_mode"
  CHECK (
    (source_mode = 'real_cycle'::exam_source_mode AND exam_cycle_id IS NOT NULL)
    OR
    (source_mode <> 'real_cycle'::exam_source_mode AND exam_cycle_id IS NULL)
  );

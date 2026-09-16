-- The similarity a question must reach before this subject will answer it.
--
-- NULL means "use the language default" — 0.50 for Latin script, 0.45 for
-- Arabic — which is what every subject used before this column and what a
-- subject keeps when its two populations cannot be separated.
--
-- WHY PER SUBJECT. Measured with scripts/measure-subject-thresholds.ts, the
-- tenth percentile of real student questions runs from 0.286 in LH Mathematics
-- to 0.716 in GS Physique. Against a single gate of 0.50/0.45 that means GS
-- جغرافيا refuses two of every three real questions while GS Chimie's gate does
-- nothing at all. One number was never going to fit seventy subjects.
--
-- WHY IT IS WRITTEN BY A SCRIPT AND NOT BY HAND. A gate is only defensible
-- relative to two measured populations — the questions a subject must answer
-- and the questions it must refuse. scripts/calibrate-subject-gates.ts measures
-- both and only lowers a gate that clears every off-syllabus question with room
-- to spare. Setting this by hand, to make a demo work, would trade wrong
-- refusals for confident wrong answers, which is the failure the gate exists to
-- prevent.
--
-- Re-calibrate after re-chunking or re-embedding: the numbers belong to the
-- embedding model and the corpus that produced them.
ALTER TABLE "subjects"
  ADD COLUMN "concept_gate" DOUBLE PRECISION;

COMMENT ON COLUMN "subjects"."concept_gate" IS
  'Per-subject concept threshold, calibrated by scripts/calibrate-subject-gates.ts. NULL = language default.';

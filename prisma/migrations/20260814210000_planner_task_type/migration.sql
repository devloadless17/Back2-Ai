-- Planner sessions gain an activity and a reason.
--
-- Both nullable: every session written before this migration was a plain study
-- block with no stated reason, and back-filling a guess would be inventing
-- history. Null reads as "unspecified", which is exactly what those rows are.

CREATE TYPE "study_session_task_type" AS ENUM ('quiz', 'flashcards', 'exam_drill', 'review');

ALTER TABLE "study_sessions"
  ADD COLUMN "task_type" "study_session_task_type",
  ADD COLUMN "rationale" TEXT;

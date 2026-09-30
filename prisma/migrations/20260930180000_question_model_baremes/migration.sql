-- A marking scheme proposed by the model for a question whose paper came
-- without one, kept on the question so every student is marked against the SAME
-- criteria rather than against a fresh set invented for each attempt.
--
-- It is deliberately NOT the `bareme` column. That one holds the ministry's own
-- scheme, and a generated one written into it would be indistinguishable from
-- the real thing the moment it was saved — to a student, to a reviewer, and to
-- the exam builder, which picks reference questions by having "a readable
-- marking scheme". Kept apart, it can be shown as provisional and can be
-- thrown away without touching anything official.
--
-- An empty array with a timestamp means the model declined, so a question that
-- cannot be marked without a figure is not paid for again by every student.
ALTER TABLE "questions"
  ADD COLUMN "model_bareme" JSONB,
  ADD COLUMN "model_bareme_model" TEXT,
  ADD COLUMN "model_bareme_at" TIMESTAMPTZ(6);

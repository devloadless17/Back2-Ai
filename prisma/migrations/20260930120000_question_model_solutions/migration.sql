-- A worked answer written by the model the first time a student asks for one,
-- kept on the question so every later student reads the same copy for free.
-- An empty string with a timestamp means the model declined (a figure it
-- cannot see), so the question is not paid for twice.
ALTER TABLE "questions"
  ADD COLUMN "model_solution" TEXT,
  ADD COLUMN "model_solution_model" TEXT,
  ADD COLUMN "model_solution_at" TIMESTAMPTZ(6);

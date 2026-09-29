ALTER TABLE "flashcard_state"
  ADD COLUMN "generated_answer" TEXT,
  ADD COLUMN "generated_answer_model" TEXT,
  ADD COLUMN "generated_answer_at" TIMESTAMPTZ(6);

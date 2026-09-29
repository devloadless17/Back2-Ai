-- Generated flashcards may be grounded in either a textbook chunk or an
-- official exam question and its correction. Exactly one source is required.
ALTER TABLE "generated_cards"
  ALTER COLUMN "source_chunk_id" DROP NOT NULL,
  ADD COLUMN "source_question_id" UUID;

ALTER TABLE "generated_cards"
  ADD CONSTRAINT "generated_cards_source_question_id_fkey"
  FOREIGN KEY ("source_question_id") REFERENCES "questions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generated_cards"
  ADD CONSTRAINT "generated_cards_one_source"
  CHECK (num_nonnulls("source_chunk_id", "source_question_id") = 1);

CREATE INDEX "generated_cards_source_question_id_idx"
  ON "generated_cards"("source_question_id");

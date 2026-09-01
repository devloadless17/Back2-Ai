-- Revision cards written from the textbook, for chapters with no attempts yet.
--
-- The deck could only ever contain questions the student had already practised,
-- because a card is created by `ensureCard` on the attempts endpoint and nowhere
-- else. That is a good rule for what a card *means* and a bad first day: a new
-- student opens the flashcards screen, has attempted nothing, and is shown an
-- empty selector with no way to fill it. The generator that fixes this has
-- existed in src/lib/flashcard-bank.ts since it was written; it had nowhere to
-- put its output.
--
-- These are NOT questions. Persisting them as `questions` with
-- source_type = 'generated' would have been half the code and would have put
-- model-written text into the corpus the product's central claim is about —
-- every question comes off an official paper or out of the official programme.
-- A separate table keeps that claim literally true and keeps generated text out
-- of retrieval, practice, exams, coverage and mastery by construction rather
-- than by remembering to filter for it.

CREATE TABLE "generated_cards" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chapter_id"          UUID NOT NULL REFERENCES "chapters"("id") ON DELETE CASCADE,
  -- The passage this card was written from and checked against. Kept because it
  -- is what makes the card auditable after the fact.
  "source_chunk_id"     UUID NOT NULL REFERENCES "content_chunks"("id") ON DELETE CASCADE,
  -- Whose deck it belongs to. Generated on request, for one student.
  "created_for_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "front"               TEXT NOT NULL,
  "back"                TEXT NOT NULL,
  "model_used"          TEXT,
  -- Set when a reviewer retires the card. Not a delete: the review queue row
  -- has to keep pointing at something.
  "retired_at"          TIMESTAMPTZ(6),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "generated_cards_created_for_user_id_created_at_idx"
  ON "generated_cards" ("created_for_user_id", "created_at");
CREATE INDEX "generated_cards_chapter_id_idx"
  ON "generated_cards" ("chapter_id");

-- A fourth thing a reviewer can be asked to look at.
ALTER TYPE "review_item_type" ADD VALUE IF NOT EXISTS 'generated_flashcard';

-- flashcard_state carries either kind of card.
--
-- The composite primary key has to go so that question_id can be nullable. Both
-- unique constraints are recreated, which is what lets every existing query and
-- the SM-2 update path keep resolving through `user_id, question_id` untouched.
--
-- Multiple NULLs are permitted by a Postgres UNIQUE, so generated rows do not
-- collide on the question_id constraint, nor question rows on the other.
ALTER TABLE "flashcard_state" DROP CONSTRAINT "flashcard_state_pkey";

ALTER TABLE "flashcard_state"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "generated_card_id" UUID
    REFERENCES "generated_cards"("id") ON DELETE CASCADE,
  ALTER COLUMN "question_id" DROP NOT NULL;

ALTER TABLE "flashcard_state" ADD PRIMARY KEY ("id");

ALTER TABLE "flashcard_state"
  ADD CONSTRAINT "flashcard_state_user_id_question_id_key"
    UNIQUE ("user_id", "question_id"),
  ADD CONSTRAINT "flashcard_state_user_id_generated_card_id_key"
    UNIQUE ("user_id", "generated_card_id");

-- Exactly one source, always. Without this a row with both columns null is a
-- card that schedules nothing, and a row with both set is a card that is two
-- different things depending on which query reads it.
ALTER TABLE "flashcard_state"
  ADD CONSTRAINT "flashcard_state_one_source"
  CHECK (("question_id" IS NULL) <> ("generated_card_id" IS NULL));

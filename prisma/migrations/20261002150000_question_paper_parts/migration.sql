-- An exercise as its printed parts, each part with its own official answer and
-- marks, matched to the paper's scheme by label. Null leaves the exercise shown
-- as one block, as before. See scripts/corpus/paper_parts.py.
ALTER TABLE "questions" ADD COLUMN "paper_parts" JSONB;

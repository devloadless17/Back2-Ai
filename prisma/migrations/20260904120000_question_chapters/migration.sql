-- The other chapters an exercise also belongs to.
--
-- A Lebanese exam exercise is cross-topic by design: one chemistry question runs
-- from an alcohol through its oxidation to the carboxylic acid, which is three
-- consecutive chapters. questions.chapter_id holds one of them, so the other two
-- never offer the exercise and a student revising aldehydes never meets it.
--
-- questions.chapter_id is untouched and stays authoritative for mastery: credit
-- for answering has to land somewhere definite. This table only answers which
-- chapters may OFFER an exercise.
CREATE TABLE "question_chapters" (
  "question_id" UUID NOT NULL,
  "chapter_id"  UUID NOT NULL,
  "score"       DOUBLE PRECISION,
  CONSTRAINT "question_chapters_pkey" PRIMARY KEY ("question_id", "chapter_id"),
  CONSTRAINT "question_chapters_question_id_fkey" FOREIGN KEY ("question_id")
    REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "question_chapters_chapter_id_fkey" FOREIGN KEY ("chapter_id")
    REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "question_chapters_chapter_id_idx" ON "question_chapters"("chapter_id");

-- Every question starts belonging to the chapter it is already filed under, so
-- a reader that consults only this table sees the same corpus as before rather
-- than an empty one. Secondary chapters are added by
-- `npm run corpus:link-chapters`, which is a separate, reversible pass.
INSERT INTO "question_chapters" ("question_id", "chapter_id", "score")
SELECT id, chapter_id, NULL FROM "questions" WHERE chapter_id IS NOT NULL;

-- A question gets a stable identity: which paper, which exercise, which part.
--
-- Until now the loader identified an exercise by its own text. That works right
-- up until the extractor improves, and then it fails in the worst available
-- way: the corrected exercise does not match the stored one, so it is inserted
-- as a new question and the old — worse — copy stays. Tonight's fix for
-- marking-scheme text leaking into statements rewrote 70 exercises, and the
-- reload duly produced 70 new rows beside the 70 it was meant to replace.
--
-- The loader already computes exactly the right key (sha256 of the paper's own
-- hash, the exercise index and the part order) and has always discarded it. It
-- is stored now, so a re-run updates what it wrote before instead of shadowing
-- it.
--
-- Nullable, because every question already in the table was written without
-- one, and inventing a key for a row whose source file we cannot re-derive
-- would make the column lie. Rows that still have no ref after a full reload
-- are the orphans this column exists to expose.

ALTER TABLE "questions" ADD COLUMN "source_ref" TEXT;

CREATE UNIQUE INDEX "questions_source_ref_key" ON "questions"("source_ref");

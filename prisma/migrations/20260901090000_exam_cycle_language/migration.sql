-- One paper, printed in three languages, is three papers.
--
-- The CRDP publishes the humanities exams in Arabic, French and English. The
-- humanities themselves are taught in Arabic, so there is one `فلسفة عامة`
-- subject and no French one — and `subjectLanguagesFor('fr')` returns
-- ['fr','ar'] precisely so a French-track student is shown it.
--
-- Exam cycles were unique on (subject, year, session), with nothing to tell the
-- three editions apart, so all three collapsed into one. Measured before this
-- migration: 254 of 1,088 cycles held more than one language, and opening
-- "Philosophie LH 2018 — session 1" showed a student 58 questions that were
-- really three separate papers in three languages stacked on top of each other.
--
-- Backfilled from the subject, which is right for every subject that only ever
-- had one edition — the sciences, which have a subject per language already.
-- The humanities are re-filed by `scripts/corpus/refile-exam-languages.ts`,
-- which reads each question's actual script rather than guessing from the
-- subject.
ALTER TABLE "exam_cycles" ADD COLUMN "language" "language" NOT NULL DEFAULT 'ar';

UPDATE "exam_cycles" ec
SET "language" = s."language"
FROM "subjects" s
WHERE s.id = ec.subject_id;

-- Prisma created the old uniqueness as a unique INDEX rather than a table
-- constraint, so it is dropped as one. `ADD CONSTRAINT ... UNIQUE` then creates
-- the replacement as a constraint-backed index, which is what the schema's
-- @@unique expects to find.
DROP INDEX IF EXISTS "exam_cycles_subject_id_year_session_key";
ALTER TABLE "exam_cycles"
  ADD CONSTRAINT "exam_cycles_subject_id_year_session_language_key"
  UNIQUE ("subject_id", "year", "session", "language");

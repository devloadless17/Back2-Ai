-- An administrator can cancel a chapter.
--
-- The ministry cuts chapters from the Lebanese programme some years, and the
-- cut is revised the year after. Deleting the row would take its questions,
-- passages, attempts and mastery with it — including the record that a student
-- had studied the chapter before it was cut. So the chapter stays and stops
-- being offered.
--
-- NULL means live, which is what every existing row is.

ALTER TABLE "chapters" ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);
ALTER TABLE "chapters" ADD COLUMN "cancelled_reason" TEXT;

-- Every student-facing chapter query filters on this alongside the subject.
CREATE INDEX "chapters_subject_id_cancelled_at_idx" ON "chapters"("subject_id", "cancelled_at");

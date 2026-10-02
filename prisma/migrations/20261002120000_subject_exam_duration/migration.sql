-- One exam length per subject, which papers fall back to unless they carry their own.
ALTER TABLE "subjects" ADD COLUMN "exam_duration_minutes" INTEGER;

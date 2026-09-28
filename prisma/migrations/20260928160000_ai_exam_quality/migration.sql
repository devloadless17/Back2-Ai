CREATE TABLE "generated_exam_papers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_id" UUID NOT NULL REFERENCES "subjects"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "blueprint" JSONB NOT NULL,
  "duration_minutes" INTEGER NOT NULL CHECK ("duration_minutes" BETWEEN 15 AND 360),
  "total_marks" DECIMAL(6,2) NOT NULL CHECK ("total_marks" > 0),
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'review', 'approved', 'rejected')),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),
  CONSTRAINT "generated_exam_papers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "generated_exam_papers_subject_id_status_idx" ON "generated_exam_papers"("subject_id", "status");
ALTER TABLE "generated_problems" ADD COLUMN "figures" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "quality_report" JSONB,
  ADD COLUMN "generated_paper_id" UUID REFERENCES "generated_exam_papers"("id") ON DELETE SET NULL,
  ADD COLUMN "paper_order" INTEGER;
CREATE UNIQUE INDEX "generated_problems_generated_paper_id_paper_order_key" ON "generated_problems"("generated_paper_id", "paper_order");

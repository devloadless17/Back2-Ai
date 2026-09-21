-- Canonical visual evidence: assets, occurrences, exercise relations, and the
-- audit verdict on legacy `content_images`.
--
-- Design record: scripts/corpus/VISUAL-EVIDENCE-MODEL.md (C1-C3 corpus audit).
--
-- ADDITIVE ONLY. No existing table is altered: `questions.content_images`
-- stays exactly as it is and keeps serving as legacy fallback. Nothing is
-- populated here; the corpus backfill is a separate, dry-run-by-default step.
--
-- Deletion rules, as the model requires:
--   deleting a question removes only its relations and its legacy audit row;
--   occurrences are facts about a PDF and survive;
--   an asset cannot be deleted while any occurrence points at it (RESTRICT).
--
-- Access policy is per occurrence, not per asset: one content hash is printed
-- both as a question figure and inside solution territory.

-- CreateEnum
CREATE TYPE "visual_access" AS ENUM ('question', 'solution');

-- CreateEnum
CREATE TYPE "visual_identity_kind" AS ENUM ('document', 'figure');

-- CreateEnum
CREATE TYPE "visual_role" AS ENUM ('question_evidence', 'exercise_shared', 'exercise_context', 'paper_shared', 'solution_material');

-- CreateEnum
CREATE TYPE "structural_confidence" AS ENUM ('exact', 'strong', 'ambiguous', 'unresolved');

-- CreateEnum
CREATE TYPE "geometric_confidence" AS ENUM ('unique', 'multiple', 'weak', 'none');

-- CreateEnum
CREATE TYPE "semantic_confidence" AS ENUM ('direct_reference', 'corroborated', 'contextual', 'ambiguous', 'unresolved');

-- CreateEnum
CREATE TYPE "visual_tier" AS ENUM ('automatic', 'gated', 'review', 'human');

-- CreateEnum
CREATE TYPE "visual_status" AS ENUM ('active', 'pending', 'rejected');

-- CreateEnum
CREATE TYPE "legacy_image_verdict" AS ENUM ('correct', 'wrong_exercise', 'wrong_page', 'header_only', 'unresolved', 'no_crop_on_page', 'no_position_source', 'untraceable');

-- CreateTable
CREATE TABLE "visual_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content_hash" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visual_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visual_occurrences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_id" UUID NOT NULL,
    "paper_sha256" TEXT NOT NULL,
    "crop_name" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "bbox_x" INTEGER NOT NULL,
    "bbox_y" INTEGER NOT NULL,
    "bbox_w" INTEGER NOT NULL,
    "bbox_h" INTEGER NOT NULL,
    "page_width" INTEGER,
    "page_height" INTEGER,
    "reading_order" INTEGER NOT NULL,
    "access" "visual_access" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "identity_kind" "visual_identity_kind",
    "identity_number" INTEGER,
    "identity_suffix" TEXT,
    "identity_text" TEXT,
    "group_key" TEXT,
    "group_part" INTEGER,
    "evidence_run" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visual_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_visuals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "role" "visual_role" NOT NULL,
    "consumers" JSONB,
    "introduced_in_stimulus" BOOLEAN NOT NULL DEFAULT false,
    "structural_confidence" "structural_confidence" NOT NULL,
    "geometric_confidence" "geometric_confidence" NOT NULL,
    "semantic_confidence" "semantic_confidence" NOT NULL,
    "tier" "visual_tier" NOT NULL,
    "status" "visual_status" NOT NULL,
    "evidence_run" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "question_visuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_image_audits" (
    "question_id" UUID NOT NULL,
    "verdict" "legacy_image_verdict" NOT NULL,
    "evidence_run" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_image_audits_pkey" PRIMARY KEY ("question_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visual_assets_content_hash_key" ON "visual_assets"("content_hash");

-- CreateIndex
CREATE INDEX "visual_occurrences_paper_sha256_page_idx" ON "visual_occurrences"("paper_sha256", "page");

-- CreateIndex
CREATE INDEX "visual_occurrences_group_key_idx" ON "visual_occurrences"("group_key");

-- CreateIndex
CREATE INDEX "visual_occurrences_evidence_run_idx" ON "visual_occurrences"("evidence_run");

-- CreateIndex
CREATE UNIQUE INDEX "visual_occurrences_paper_sha256_crop_name_key" ON "visual_occurrences"("paper_sha256", "crop_name");

-- CreateIndex
CREATE INDEX "question_visuals_question_id_status_role_idx" ON "question_visuals"("question_id", "status", "role");

-- CreateIndex
CREATE INDEX "question_visuals_occurrence_id_idx" ON "question_visuals"("occurrence_id");

-- CreateIndex
CREATE INDEX "question_visuals_evidence_run_idx" ON "question_visuals"("evidence_run");

-- CreateIndex
CREATE UNIQUE INDEX "question_visuals_question_id_occurrence_id_key" ON "question_visuals"("question_id", "occurrence_id");

-- CreateIndex
CREATE INDEX "legacy_image_audits_evidence_run_idx" ON "legacy_image_audits"("evidence_run");

-- AddForeignKey
ALTER TABLE "visual_occurrences" ADD CONSTRAINT "visual_occurrences_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "visual_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_visuals" ADD CONSTRAINT "question_visuals_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_visuals" ADD CONSTRAINT "question_visuals_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "visual_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_image_audits" ADD CONSTRAINT "legacy_image_audits_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


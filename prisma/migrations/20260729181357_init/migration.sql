-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "role" AS ENUM ('student', 'admin');

-- CreateEnum
CREATE TYPE "language" AS ENUM ('fr', 'en', 'ar');

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('past_exam', 'textbook', 'generated');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('mcq', 'open', 'problem');

-- CreateEnum
CREATE TYPE "verified_status" AS ENUM ('unverified', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('pending', 'solver_passed', 'solver_failed', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "exam_source_mode" AS ENUM ('real_cycle', 'ai_generated');

-- CreateEnum
CREATE TYPE "exam_sim_status" AS ENUM ('in_progress', 'submitted', 'graded');

-- CreateEnum
CREATE TYPE "submission_type" AS ENUM ('typed', 'photo');

-- CreateEnum
CREATE TYPE "attempt_context" AS ENUM ('practice', 'quiz', 'exam_sim');

-- CreateEnum
CREATE TYPE "chat_role" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "grounding_tier" AS ENUM ('exact_match', 'concept_level', 'personal_reference', 'ungrounded_refused');

-- CreateEnum
CREATE TYPE "study_session_source" AS ENUM ('manual', 'ai_suggested');

-- CreateEnum
CREATE TYPE "study_session_status" AS ENUM ('planned', 'done', 'skipped');

-- CreateEnum
CREATE TYPE "review_item_type" AS ENUM ('generated_problem', 'tagged_question', 'flagged_content');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('flashcards_due', 'schedule_reminder', 'announcement');

-- CreateEnum
CREATE TYPE "ingestion_job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "content_chunk_kind" AS ENUM ('definition', 'formula', 'theorem', 'method', 'worked_example');

-- CreateEnum
CREATE TYPE "linked_action" AS ENUM ('quiz', 'flashcards', 'practice', 'exam_sim');

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "track_id" UUID,
    "name" TEXT NOT NULL,
    "language" "language" NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "unit_id" UUID,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "role" NOT NULL DEFAULT 'student',
    "track_id" UUID,
    "preferred_language" "language" NOT NULL,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "session" TEXT,
    "title" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 180,

    CONSTRAINT "exam_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chapter_id" UUID NOT NULL,
    "source_type" "source_type" NOT NULL,
    "source_exam_id" UUID,
    "question_type" "question_type" NOT NULL,
    "difficulty" DECIMAL(3,2),
    "difficulty_confidence" DECIMAL(3,2),
    "content_text" TEXT NOT NULL,
    "content_latex" TEXT,
    "content_images" TEXT[],
    "options" JSONB,
    "correct_option_id" TEXT,
    "official_solution" TEXT,
    "official_solution_latex" TEXT,
    "bareme" JSONB,
    "order_index" INTEGER,
    "verified_status" "verified_status" NOT NULL DEFAULT 'unverified',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chapter_id" UUID NOT NULL,
    "kind" "content_chunk_kind" NOT NULL,
    "title" TEXT,
    "content_text" TEXT NOT NULL,
    "content_latex" TEXT,
    "source_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),

    CONSTRAINT "content_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_problems" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chapter_id" UUID NOT NULL,
    "style_reference_ids" UUID[],
    "content_text" TEXT NOT NULL,
    "content_latex" TEXT,
    "generated_solution" TEXT NOT NULL,
    "bareme" JSONB,
    "final_answer" TEXT NOT NULL,
    "difficulty" DECIMAL(3,2),
    "verification_status" "verification_status" NOT NULL DEFAULT 'pending',
    "verification_notes" TEXT,
    "model_used" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "embedding" vector(1536),

    CONSTRAINT "generated_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_simulations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "source_mode" "exam_source_mode" NOT NULL,
    "exam_cycle_id" UUID,
    "status" "exam_sim_status" NOT NULL DEFAULT 'in_progress',
    "duration_minutes" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "total_score" DECIMAL(6,2),
    "max_score" DECIMAL(6,2),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    "graded_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_simulation_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exam_simulation_id" UUID NOT NULL,
    "question_id" UUID,
    "generated_problem_id" UUID,
    "order_index" INTEGER NOT NULL,
    "bareme_snapshot" JSONB,
    "max_score" DECIMAL(5,2),

    CONSTRAINT "exam_simulation_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exam_simulation_question_id" UUID NOT NULL,
    "submission_type" "submission_type" NOT NULL,
    "typed_answer" TEXT,
    "photo_url" TEXT,
    "ocr_extracted_text" TEXT,
    "ocr_consistency_checked" BOOLEAN NOT NULL DEFAULT false,
    "ocr_consistency_passed" BOOLEAN,
    "ocr_consistency_notes" TEXT,
    "bareme_result" JSONB,
    "total_score" DECIMAL(5,2),
    "max_score" DECIMAL(5,2),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graded_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "question_id" UUID,
    "generated_problem_id" UUID,
    "is_correct" BOOLEAN,
    "submitted_answer" TEXT,
    "score" DECIMAL(5,2),
    "max_score" DECIMAL(5,2),
    "time_taken_seconds" INTEGER,
    "context" "attempt_context" NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_mastery" (
    "user_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "mastery_score" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "attempts_count" INTEGER NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_mastery_pkey" PRIMARY KEY ("user_id","chapter_id")
);

-- CreateTable
CREATE TABLE "flashcard_state" (
    "user_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "easiness" DECIMAL(3,2) NOT NULL DEFAULT 2.5,
    "interval_days" INTEGER NOT NULL DEFAULT 1,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "last_reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "flashcard_state_pkey" PRIMARY KEY ("user_id","question_id")
);

-- CreateTable
CREATE TABLE "readiness_scores" (
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "mastery_component" DECIMAL(4,3),
    "coverage_component" DECIMAL(4,3),
    "trend_component" DECIMAL(4,3),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readiness_scores_pkey" PRIMARY KEY ("user_id","subject_id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "question_id" UUID,
    "uploaded_image_url" TEXT,
    "title" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "role" "chat_role" NOT NULL,
    "content" TEXT NOT NULL,
    "grounding_tier" "grounding_tier",
    "cited_source_ids" UUID[],
    "top_similarity" DECIMAL(5,4),
    "model_used" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "extracted_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),

    CONSTRAINT "user_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_grades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject_id" UUID,
    "label" TEXT,
    "grade" DECIMAL(5,2),
    "max_grade" DECIMAL(5,2),
    "date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "chapter_id" UUID,
    "title" TEXT NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "duration_minutes" INTEGER,
    "source" "study_session_source" NOT NULL DEFAULT 'manual',
    "status" "study_session_status" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upcoming_exams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject_id" UUID,
    "exam_date" DATE NOT NULL,
    "label" TEXT,
    "is_bac_exam" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upcoming_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "linked_chapter_id" UUID,
    "linked_action" "linked_action",
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "target_track_id" UUID,
    "target_subject_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_type" "review_item_type" NOT NULL,
    "item_id" UUID NOT NULL,
    "flag_reason" TEXT,
    "flagged_by_user_id" UUID,
    "status" "review_status" NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" UUID,
    "review_notes" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "subject_id" UUID,
    "status" "ingestion_job_status" NOT NULL DEFAULT 'queued',
    "source_label" TEXT,
    "items_total" INTEGER NOT NULL DEFAULT 0,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_failed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "log" JSONB,
    "triggered_by" UUID,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracks_code_key" ON "tracks"("code");

-- CreateIndex
CREATE INDEX "subjects_track_id_idx" ON "subjects"("track_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_subject_id_order_index_key" ON "units"("subject_id", "order_index");

-- CreateIndex
CREATE INDEX "chapters_unit_id_idx" ON "chapters"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_subject_id_order_index_key" ON "chapters"("subject_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_track_id_idx" ON "users"("track_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_idx" ON "audit_events"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at");

-- CreateIndex
CREATE INDEX "exam_cycles_subject_id_year_idx" ON "exam_cycles"("subject_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "exam_cycles_subject_id_year_session_key" ON "exam_cycles"("subject_id", "year", "session");

-- CreateIndex
CREATE INDEX "questions_chapter_id_difficulty_idx" ON "questions"("chapter_id", "difficulty");

-- CreateIndex
CREATE INDEX "questions_source_exam_id_order_index_idx" ON "questions"("source_exam_id", "order_index");

-- CreateIndex
CREATE INDEX "questions_verified_status_idx" ON "questions"("verified_status");

-- CreateIndex
CREATE INDEX "content_chunks_chapter_id_kind_idx" ON "content_chunks"("chapter_id", "kind");

-- CreateIndex
CREATE INDEX "generated_problems_chapter_id_verification_status_idx" ON "generated_problems"("chapter_id", "verification_status");

-- CreateIndex
CREATE INDEX "generated_problems_published_at_idx" ON "generated_problems"("published_at");

-- CreateIndex
CREATE INDEX "exam_simulations_user_id_started_at_idx" ON "exam_simulations"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "exam_simulations_status_idx" ON "exam_simulations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_simulation_questions_exam_simulation_id_order_index_key" ON "exam_simulation_questions"("exam_simulation_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "exam_answers_exam_simulation_question_id_key" ON "exam_answers"("exam_simulation_question_id");

-- CreateIndex
CREATE INDEX "attempts_user_id_attempted_at_idx" ON "attempts"("user_id", "attempted_at");

-- CreateIndex
CREATE INDEX "attempts_question_id_idx" ON "attempts"("question_id");

-- CreateIndex
CREATE INDEX "chapter_mastery_user_id_mastery_score_idx" ON "chapter_mastery"("user_id", "mastery_score");

-- CreateIndex
CREATE INDEX "flashcard_state_user_id_due_date_idx" ON "flashcard_state"("user_id", "due_date");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_updated_at_idx" ON "chat_sessions"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "user_references_user_id_idx" ON "user_references"("user_id");

-- CreateIndex
CREATE INDEX "user_grades_user_id_date_idx" ON "user_grades"("user_id", "date");

-- CreateIndex
CREATE INDEX "study_sessions_user_id_scheduled_date_idx" ON "study_sessions"("user_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "upcoming_exams_user_id_exam_date_idx" ON "upcoming_exams"("user_id", "exam_date");

-- CreateIndex
CREATE INDEX "todos_user_id_is_done_idx" ON "todos"("user_id", "is_done");

-- CreateIndex
CREATE INDEX "announcements_created_at_idx" ON "announcements"("created_at");

-- CreateIndex
CREATE INDEX "review_queue_status_created_at_idx" ON "review_queue"("status", "created_at");

-- CreateIndex
CREATE INDEX "review_queue_item_type_item_id_idx" ON "review_queue"("item_type", "item_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "ingestion_jobs_status_created_at_idx" ON "ingestion_jobs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_cycles" ADD CONSTRAINT "exam_cycles_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_exam_id_fkey" FOREIGN KEY ("source_exam_id") REFERENCES "exam_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_problems" ADD CONSTRAINT "generated_problems_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_exam_cycle_id_fkey" FOREIGN KEY ("exam_cycle_id") REFERENCES "exam_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulation_questions" ADD CONSTRAINT "exam_simulation_questions_exam_simulation_id_fkey" FOREIGN KEY ("exam_simulation_id") REFERENCES "exam_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulation_questions" ADD CONSTRAINT "exam_simulation_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulation_questions" ADD CONSTRAINT "exam_simulation_questions_generated_problem_id_fkey" FOREIGN KEY ("generated_problem_id") REFERENCES "generated_problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_exam_simulation_question_id_fkey" FOREIGN KEY ("exam_simulation_question_id") REFERENCES "exam_simulation_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_generated_problem_id_fkey" FOREIGN KEY ("generated_problem_id") REFERENCES "generated_problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_mastery" ADD CONSTRAINT "chapter_mastery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_mastery" ADD CONSTRAINT "chapter_mastery_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_state" ADD CONSTRAINT "flashcard_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_state" ADD CONSTRAINT "flashcard_state_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readiness_scores" ADD CONSTRAINT "readiness_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readiness_scores" ADD CONSTRAINT "readiness_scores_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_references" ADD CONSTRAINT "user_references_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_grades" ADD CONSTRAINT "user_grades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_grades" ADD CONSTRAINT "user_grades_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_exams" ADD CONSTRAINT "upcoming_exams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_exams" ADD CONSTRAINT "upcoming_exams_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_linked_chapter_id_fkey" FOREIGN KEY ("linked_chapter_id") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_target_track_id_fkey" FOREIGN KEY ("target_track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_target_subject_id_fkey" FOREIGN KEY ("target_subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_flagged_by_user_id_fkey" FOREIGN KEY ("flagged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Vector indexes (hand-written: Prisma cannot express pgvector index types)
--
-- HNSW rather than the ivfflat named in the exec plan. ivfflat builds its
-- clusters from the data present at CREATE INDEX time, and a migration always
-- runs against an empty table -- the resulting index has poor recall until it
-- is manually rebuilt after ingestion, which is a step nobody remembers. HNSW
-- builds incrementally, needs no training pass, and gives better recall at this
-- corpus size. Cost is a slower insert, which is irrelevant here: embeddings
-- are written by batch ingestion, not on a student request path.
--
-- vector_cosine_ops matches the `<=>` operator used in src/lib/vector.ts.
-- ---------------------------------------------------------------------------

CREATE INDEX "questions_embedding_hnsw_idx"
  ON "questions" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "content_chunks_embedding_hnsw_idx"
  ON "content_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "generated_problems_embedding_hnsw_idx"
  ON "generated_problems" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "user_references_embedding_hnsw_idx"
  ON "user_references" USING hnsw ("embedding" vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Integrity constraints the ORM cannot enforce
-- ---------------------------------------------------------------------------

-- An attempt records exactly one of a real question or a generated problem.
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_one_source"
  CHECK (num_nonnulls("question_id", "generated_problem_id") = 1);

-- Same rule for a question slot inside an exam simulation.
ALTER TABLE "exam_simulation_questions" ADD CONSTRAINT "exam_sim_questions_one_source"
  CHECK (num_nonnulls("question_id", "generated_problem_id") = 1);

-- A real-cycle simulation must name its cycle; a generated one must not.
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_cycle_matches_mode"
  CHECK (
    ("source_mode" = 'real_cycle' AND "exam_cycle_id" IS NOT NULL)
    OR ("source_mode" = 'ai_generated' AND "exam_cycle_id" IS NULL)
  );

-- Marks cannot be negative, and cannot exceed what the paper was out of.
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_score_in_range"
  CHECK (
    "total_score" IS NULL OR "max_score" IS NULL
    OR ("total_score" >= 0 AND "total_score" <= "max_score")
  );

-- Mastery and readiness are probabilities.
ALTER TABLE "chapter_mastery" ADD CONSTRAINT "chapter_mastery_score_range"
  CHECK ("mastery_score" >= 0 AND "mastery_score" <= 1);

ALTER TABLE "readiness_scores" ADD CONSTRAINT "readiness_score_range"
  CHECK ("score" >= 0 AND "score" <= 1);

-- SM-2 never lets easiness fall below 1.3.
ALTER TABLE "flashcard_state" ADD CONSTRAINT "flashcard_easiness_floor"
  CHECK ("easiness" >= 1.3);

-- A student may only sit one simulation at a time. Partial unique index, so it
-- constrains in-progress rows only and leaves completed history alone.
CREATE UNIQUE INDEX "exam_simulations_one_in_progress_per_user"
  ON "exam_simulations" ("user_id") WHERE "status" = 'in_progress';

-- Email uniqueness must be case-insensitive: Bac@example.com and
-- bac@example.com are the same person to everyone except a byte comparison.
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (LOWER("email"));

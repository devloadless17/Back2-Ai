-- The language an announcement was written in, and its translations.
-- Additive: existing rows default to English, which is what the cohort's
-- interface defaults to, and no translation row means "show the original".
ALTER TABLE "announcements" ADD COLUMN "language" "language" NOT NULL DEFAULT 'en';

CREATE TABLE "announcement_translations" (
    "announcement_id" UUID NOT NULL,
    "locale" "language" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_translations_pkey" PRIMARY KEY ("announcement_id", "locale")
);

ALTER TABLE "announcement_translations"
  ADD CONSTRAINT "announcement_translations_announcement_id_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

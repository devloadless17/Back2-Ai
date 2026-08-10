-- Country of study, billing state, and attempt-anchored tutoring.
--
-- `users.country` is backfilled to 'LB' for every existing row: Lebanon is the
-- only curriculum ingested, so that is a statement of fact rather than a guess.
--
-- `subscriptions` holds no card number and no CVC, by design — see the model
-- comment in schema.prisma.

-- CreateEnum
CREATE TYPE "subscription_plan" AS ENUM ('free', 'monthly', 'annual');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('pending', 'active', 'past_due', 'canceled');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "country" CHAR(2) NOT NULL DEFAULT 'LB';

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN "attempt_id" UUID;

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan" "subscription_plan" NOT NULL DEFAULT 'free',
    "status" "subscription_status" NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "provider_customer_id" TEXT,
    "provider_subscription_id" TEXT,
    "card_brand" TEXT,
    "card_last4" CHAR(4),
    "card_exp_month" INTEGER,
    "card_exp_year" INTEGER,
    "cardholder_name" TEXT,
    "current_period_end" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing account predates billing; give each one the same free/pending
-- row a new signup would get, so no code path has to handle a missing row.
INSERT INTO "subscriptions" ("user_id", "plan", "status")
SELECT "id", 'free', 'pending' FROM "users"
ON CONFLICT ("user_id") DO NOTHING;

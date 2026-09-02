-- Email confirmation, reminder delivery, and the tokens both need.
--
-- Every column is additive and every existing row keeps working. The one
-- judgement here is the backfill: login is going to refuse an account whose
-- email is unconfirmed, and every account that already exists predates the
-- concept. Leaving them null would lock out the whole user base — including the
-- demo account — the moment that check ships. They are treated as confirmed,
-- which is what they effectively were.
ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "email_reminders"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "push_reminders"    BOOLEAN NOT NULL DEFAULT true;

UPDATE "users" SET "email_verified_at" = now() WHERE "email_verified_at" IS NULL;

CREATE TYPE "auth_token_purpose" AS ENUM ('email_verify', 'password_reset');

-- Only the hash is stored, for the same reason session tokens are hashed: a
-- leaked database must not hand over working links to reset every password.
CREATE TABLE "auth_tokens" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID NOT NULL,
  "purpose"    "auth_token_purpose" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at"    TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens"("expires_at");

-- One row per browser. A student with a laptop and a phone has two, and
-- silencing one must not silence the other.
CREATE TABLE "push_subscriptions" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL,
  "endpoint"     TEXT NOT NULL,
  "p256dh"       TEXT NOT NULL,
  "auth"         TEXT NOT NULL,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

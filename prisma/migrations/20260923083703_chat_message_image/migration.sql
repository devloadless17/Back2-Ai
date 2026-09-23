-- The photo a question was asked about, kept on the message.
-- Nullable and additive: existing rows are messages with no attachment.
ALTER TABLE "chat_messages" ADD COLUMN "image_key" TEXT;

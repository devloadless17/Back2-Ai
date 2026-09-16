-- The subject a conversation is about.
--
-- Until now every question a student asked was searched against EVERY subject
-- of their track at once — fifteen or so, in two scripts. retrieval.ts records
-- what that costs: asked "quelle est la différence entre le doute et la
-- philosophie ?", it ranks a French literature passage at 0.528 and the Arabic
-- philosophy chapter that actually answers it at 0.399, and answers confidently
-- from the wrong subject.
--
-- Naming the subject before the first message removes that class of error
-- outright rather than mitigating it, and it is also what the student already
-- knows: they are revising one subject at a time.
--
-- NULLABLE, and null is not a defect. It means "all my subjects", which is what
-- every existing conversation is and what the general-help option stays. The
-- column narrows the search when it is set and changes nothing when it is not.
--
-- ON DELETE SET NULL rather than CASCADE: re-seeding the taxonomy replaces
-- subject rows, and a student's conversation history must survive that. Losing
-- the scope is recoverable; losing the conversation is not.
ALTER TABLE "chat_sessions"
  ADD COLUMN "subject_id" UUID;

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "chat_sessions_subject_id_idx" ON "chat_sessions"("subject_id");

-- A message that was never a curriculum question.
--
-- Without this, a greeting was stored as `ungrounded_refused` and shown to the
-- student as "Not covered by the curriculum". That is a claim about their
-- programme, made about a message that asked nothing about it, and it also
-- inflated every refusal metric with people saying hello.
ALTER TYPE "grounding_tier" ADD VALUE IF NOT EXISTS 'conversational';

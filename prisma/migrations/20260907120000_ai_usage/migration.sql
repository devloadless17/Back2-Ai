-- What each student's AI use costs, so it can be capped.
--
-- Nothing recorded token counts before this, so "how much does a student cost"
-- could only be answered by arithmetic over measured character counts. The
-- providers already return input and output tokens on every call; they were
-- simply dropped on the floor.
--
-- Cost is stored in micro-dollars as an integer. A per-call cost is fractions of
-- a cent and a month's total is a few dollars, so a float would accumulate
-- rounding across thousands of rows in exactly the column a bill is read from.
CREATE TABLE ai_usage (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  model            text NOT NULL,
  input_tokens     integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens    integer NOT NULL DEFAULT 0,
  cost_micros      bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The only query that runs on the hot path: this student's spend this month.
CREATE INDEX ai_usage_user_created_idx ON ai_usage (user_id, created_at DESC);

-- For the admin view: what the whole service costs, by day and by kind.
CREATE INDEX ai_usage_created_idx ON ai_usage (created_at DESC);

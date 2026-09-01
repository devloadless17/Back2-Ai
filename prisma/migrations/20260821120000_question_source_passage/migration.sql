-- The text printed on the exam paper that a question is asked about.
--
-- Comprehension questions are answerable only against a passage that exists on
-- the paper and in no chapter of any book. The extractor has always read it and
-- thrown it away; this is where it goes. Nullable because most questions —
-- every maths and physics exercise — have no passage and never will.
ALTER TABLE "questions" ADD COLUMN "source_passage" TEXT;

-- Whether an exam cycle's duration is the paper's own, or our fallback.
--
-- `duration_minutes` defaults to 180 and the bulk corpus loader never sets it,
-- so an ingested official paper was indistinguishable from one we actually know
-- runs three hours. Every real past paper was therefore sat on a three-hour
-- clock while being described as sat exactly as it was printed. Lebanese Bac
-- Mathematics SG is four hours.
--
-- Default FALSE is the honest backfill: nothing in the corpus recorded a
-- duration, so nothing may claim one. The seed sets it true for the papers
-- whose durations it does carry, and `scripts/ingest.ts --duration` sets it
-- for a paper ingested with an explicit one.
--
-- Written by hand rather than generated, because another migration is in
-- flight in this working tree and `prisma migrate` would have diffed against
-- a schema that is not committed.
ALTER TABLE "exam_cycles"
  ADD COLUMN "duration_is_official" BOOLEAN NOT NULL DEFAULT FALSE;

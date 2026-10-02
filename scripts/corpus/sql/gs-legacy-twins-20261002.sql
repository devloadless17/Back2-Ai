-- Hide the pre-`source_ref` copy of a GS past-paper exercise when the same
-- paper also shows the keyed copy of it. Reversible:
--   UPDATE questions q SET verified_status = b.verified_status
--     FROM backup_gs_legacy_twins_20261002 b WHERE b.id = q.id;
--
-- load-exams.ts retires such a twin only when both copies sit under the SAME
-- chapter, and refiling moved one of each of these pairs, so the paper page
-- printed the exercise twice. Matched here on the paper (cycle) instead, and
-- on the first 80 characters of the statement with whitespace removed — the
-- same exercise read twice, not two exercises at one position (Physics GS
-- 2005 session 2 has one of those, and it is left alone).
BEGIN;

CREATE TABLE backup_gs_legacy_twins_20261002 AS
SELECT a.id, a.verified_status
FROM questions a
JOIN exam_cycles ec ON ec.id = a.source_exam_id
JOIN subjects s ON s.id = ec.subject_id
JOIN tracks t ON t.id = s.track_id
WHERE t.code = 'GS'
  AND a.source_ref IS NULL
  AND a.source_type = 'past_exam'
  AND a.verified_status <> 'rejected'
  AND EXISTS (
    SELECT 1 FROM questions b
    WHERE b.source_exam_id = a.source_exam_id
      AND b.source_ref IS NOT NULL
      AND b.verified_status <> 'rejected'
      AND left(regexp_replace(b.content_text, '\s+', '', 'g'), 80)
        = left(regexp_replace(a.content_text, '\s+', '', 'g'), 80)
  );

UPDATE questions q SET verified_status = 'rejected'
FROM backup_gs_legacy_twins_20261002 b
WHERE b.id = q.id;

SELECT count(*) AS hidden FROM backup_gs_legacy_twins_20261002;

COMMIT;

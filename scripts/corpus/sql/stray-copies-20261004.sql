-- Past-paper rows with no source_ref that are old reads of a question the loader
-- has since written properly (found 2026-10-04 checking LH answers).
-- load-exams.ts retires such a row only when its keyed twin is in the SAME
-- CHAPTER; after the chapter re-filing many twins are not, so the old copy
-- (letterhead, key text and all) stayed on the paper beside the good one.
-- Here the twin must be in the same paper instead. GS, SE and LH only; LS is
-- left to its own session. Hidden, not deleted.
-- Undo: UPDATE questions q SET verified_status = b.verified_status
--   FROM backup_stray_copies_20261004 b WHERE b.id = q.id;
CREATE TABLE backup_stray_copies_20261004 AS
SELECT a.id, a.verified_status
  FROM questions a JOIN exam_cycles e ON e.id = a.source_exam_id
 WHERE a.source_ref IS NULL AND a.source_type = 'past_exam' AND a.verified_status <> 'rejected'
   AND e.title ~ ' (GS|SE|LH) ' AND e.title !~* 'philo'
   AND (
     -- a keyed copy in the same paper starts the same way
     EXISTS (SELECT 1 FROM questions b
              WHERE b.source_ref IS NOT NULL AND b.verified_status <> 'rejected'
                AND b.source_exam_id = a.source_exam_id
                AND left(regexp_replace(b.content_text, '\s+', '', 'g'), 30)
                  = left(regexp_replace(a.content_text, '\s+', '', 'g'), 30))
     -- the same, but the old read has stray characters in front:
     -- "Olive oil … ″Olive oil" (LH 2006-2 chemistry), "pt. Many sociologists" (LH 2006-1 English)
     OR EXISTS (SELECT 1 FROM questions b
              WHERE b.source_ref IS NOT NULL AND b.verified_status <> 'rejected'
                AND b.source_exam_id = a.source_exam_id
                AND strpos(left(regexp_replace(a.content_text, '[^[:alpha:]]+', '', 'g'), 100),
                           left(regexp_replace(b.content_text, '[^[:alpha:]]+', '', 'g'), 80)) > 0
                AND (a.content_text LIKE 'Olive oil%' OR a.content_text ~ '^pt\.\s+Many sociologists'))
     -- a 249-character fragment with the ministry letterhead, alone in a second
     -- "Physique LH 2021 — session 2"; the real exercise 3 is in the first one
     OR (e.title = 'Physique LH 2021 — session 2' AND length(a.content_text) < 400
         AND a.content_text LIKE 'Énergie électrique produite par un réacteur nucléaire%وزارة%')
   );
-- "The Vegetarian Diet" (LH 2004-2 chemistry, exercise 2) is held twice, both
-- refless, nothing keyed: keep one.
INSERT INTO backup_stray_copies_20261004
SELECT a.id, a.verified_status
  FROM questions a JOIN exam_cycles e ON e.id = a.source_exam_id
 WHERE e.title = 'Chemistry LH 2004 — session 2' AND a.source_ref IS NULL
   AND a.verified_status <> 'rejected' AND a.content_text LIKE 'The Vegetarian Diet%'
   AND a.id <> (SELECT min(c.id::text)::uuid FROM questions c
                 WHERE c.source_exam_id = a.source_exam_id AND c.source_ref IS NULL
                   AND c.verified_status <> 'rejected' AND c.content_text LIKE 'The Vegetarian Diet%');
UPDATE questions SET verified_status = 'rejected'
 WHERE id IN (SELECT id FROM backup_stray_copies_20261004);
SELECT count(*) AS hidden FROM backup_stray_copies_20261004;

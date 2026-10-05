-- Geography 2017, GS and SE, filed by what each paper's own header says (found 2026-10-05).
--   bf7a7d2a90cf = "دورة 2017 الاستثنائية، 5 آب / فرعا علوم عامة واجتماع واقتصاد": GS+SE SESSION 2.
--     It sat in GS 2017-1 (gs/2017 1/geo.pdf) and SE 2017-1 (se/2017 2/geo_crdp.pdf was
--     recorded as session "2017 1"). Moved to GS 2017-2 and SE 2017-2 (created).
--   360a2b50706c = "فرع علوم الحياة" only, 8 آب: the LS paper, copied into gs/2017 2. Hidden from GS.
--   db2a69c73f29 = "فرع الآداب والإنسانيات", 13 حزيران: the LH paper; CRDP labels it SE 2017-1. Hidden from SE.
-- GS 2017-1 and SE 2017-1 geography are not on CRDP, so those papers end up empty (the list skips them).
-- Undo: UPDATE questions q SET source_exam_id = b.source_exam_id, verified_status = b.verified_status
--   FROM backup_geo_2017_refile_20261005 b WHERE b.id = q.id;
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE ex (sha text, idx text, ord int);
INSERT INTO ex VALUES
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '1', 0),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '2', 1),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '3', 2),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '4', 3),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '5', 4),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '6', 5),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '7', 6),
('360a2b50706c122a05a66168458020ef4228e3f3823d35182644468a1a20536a', '1', 0),
('360a2b50706c122a05a66168458020ef4228e3f3823d35182644468a1a20536a', '2', 1),
('360a2b50706c122a05a66168458020ef4228e3f3823d35182644468a1a20536a', '3', 2),
('360a2b50706c122a05a66168458020ef4228e3f3823d35182644468a1a20536a', '4', 3),
('360a2b50706c122a05a66168458020ef4228e3f3823d35182644468a1a20536a', '5', 4),
('360a2b50706c122a05a66168458020ef4228e3f3823d35182644468a1a20536a', '6', 5),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '1', 0),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '2', 1),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '3', 2),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '4', 3),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '5', 4),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '6', 5),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '7', 6),
('db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e', '8', 7);
CREATE TEMP TABLE r AS
SELECT DISTINCT q.id, q.source_exam_id, e.title, e.subject_id, e.year, e.language, ex.sha
  FROM ex CROSS JOIN subjects s
  JOIN questions q ON q.source_ref = encode(sha256(convert_to(s.id::text || ':' || ex.sha || ':' || ex.idx || ':' || ex.ord, 'UTF8')), 'hex')
  JOIN exam_cycles e ON e.id = q.source_exam_id
 WHERE e.title IN ('Geographie GS 2017 — session 1', 'جغرافيا GS 2017 — session 2', 'جغرافيا SE 2017 — session 1');
SELECT title, left(sha, 12) AS paper, count(*) FROM r GROUP BY 1, 2 ORDER BY 1, 2;
CREATE TABLE backup_geo_2017_refile_20261005 AS
SELECT q.id, q.source_exam_id, q.verified_status FROM questions q WHERE q.id IN (SELECT id FROM r);
INSERT INTO exam_cycles (subject_id, year, session, title, duration_minutes, language, duration_is_official)
SELECT subject_id, year, 'session2', 'جغرافيا SE 2017 — session 2', duration_minutes, language, duration_is_official
  FROM exam_cycles WHERE title = 'جغرافيا SE 2017 — session 1'
    ON CONFLICT (subject_id, year, session, language) DO NOTHING;
-- The session-2 paper goes to session 2 of its own subject.
UPDATE questions q SET source_exam_id = t.id
  FROM r JOIN exam_cycles t ON t.subject_id = r.subject_id AND t.year = r.year AND t.language = r.language AND t.session = 'session2'
 WHERE q.id = r.id AND r.sha = 'bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb' AND r.title IN ('Geographie GS 2017 — session 1', 'جغرافيا SE 2017 — session 1');
UPDATE questions SET verified_status = 'rejected'
 WHERE id IN (SELECT id FROM r WHERE (title = 'جغرافيا GS 2017 — session 2' AND sha = '360a2b50706c122a05a66168458020ef4228e3f3823d35182644468a1a20536a')
                                  OR (title = 'جغرافيا SE 2017 — session 1' AND sha = 'db2a69c73f293dff67814558b340f7eb1b6cbb4e6c62f8bd6b4bb626cfec3e7e'));
SELECT e.title, count(*) FILTER (WHERE q.verified_status <> 'rejected') AS shown
  FROM exam_cycles e LEFT JOIN questions q ON q.source_exam_id = e.id
 WHERE e.title ~ '^(Geographie|جغرافيا) (GS|SE) 2017' GROUP BY 1 ORDER BY 1;
COMMIT;

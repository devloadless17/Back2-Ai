-- Refiles the six LH Arabic exam questions that sat under essay chapters only
-- because the Tagore unit and Samman's essay had no chapter of their own.
-- Run after lh-arabic-lit-missing-lessons.sql. Filed by reading each question:
--
--   five from the exams' "في الثقافة الأدبية العالمية" section, quoting
--   "جنى الثمار" or asking about nature as the poet's inspiration -> جنى الثمار
--   "منذ غادرتُ بيروت بحرًا..." (exile, the sea of Beirut)          -> Samman
--
-- Guarded by question id and by the chapter each one is expected to be on,
-- so a second run, or a database where they moved already, changes nothing.

BEGIN;

CREATE TEMP TABLE moves (question_id uuid, to_chapter text) ON COMMIT DROP;
INSERT INTO moves VALUES
  ('1815d4eb-d32d-4b60-99a0-3e7e76dea4e1', 'جنى الثمار'),
  ('6517c6f7-e2cb-425e-88df-ea85690bddf2', 'جنى الثمار'),
  ('73af6714-dc35-4a6f-a26b-bd8a209dd34f', 'جنى الثمار'),
  ('cb7b6acb-e16a-4683-b103-d2e3e61a3a61', 'جنى الثمار'),
  ('ab17e7d3-0750-4af7-acc5-62b6b7951d90', 'جنى الثمار'),
  ('d993495d-a308-4a8f-9302-b3c31fb0d8c5', 'مَن يعيد توابيتنا إلى الوطن: غادة السمّان');

CREATE TEMP TABLE targets ON COMMIT DROP AS
SELECT m.question_id, c.id AS chapter_id, q.chapter_id AS from_chapter
FROM moves m
JOIN questions q ON q.id = m.question_id
JOIN chapters old ON old.id = q.chapter_id
JOIN chapters c ON c.subject_id = old.subject_id AND c.name = m.to_chapter
WHERE old.name IN ('التجارة وأثرها في بناء الأمّة: محيي الدين النصولي',
                   'الحياة في باريس: حليم أبو عزّ الدين');

UPDATE questions q SET chapter_id = t.chapter_id FROM targets t WHERE q.id = t.question_id;
DELETE FROM question_chapters qc USING targets t
  WHERE qc.question_id = t.question_id AND qc.chapter_id = t.from_chapter;
INSERT INTO question_chapters (question_id, chapter_id)
  SELECT question_id, chapter_id FROM targets ON CONFLICT DO NOTHING;

SELECT count(*) AS moved FROM targets;
COMMIT;

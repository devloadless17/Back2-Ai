-- Adds the LH Arabic literature lessons the chapter list stopped short of.
--
--   psql ... -f scripts/corpus/lh-arabic-lit-missing-lessons.sql
--
-- The LH reader (arabic-lit-lh__3c72187a) prints eight units; its contents
-- override (scripts/corpus/toc-overrides/arabic-lit-lh__3c72187a.md) was
-- copied only as far as the third essay of المقالة. Samman and Maalouf, the
-- whole Arab-theatre unit and the whole Tagore unit had no chapter, so their
-- passages were filed under "الحياة في باريس".
--
-- Chapters are keyed on (subject, order_index) and the grammar book's chapters
-- follow the literature book's in the same subject (prisma/taxonomy-loader.ts).
-- Re-running the seeder with a longer literature list would therefore RENAME
-- the first grammar rows, questions and all. So the grammar units and chapters
-- are moved up first, and the new rows take exactly the indices the seeder
-- would give them: a later seed then updates in place and renames nothing.
--
-- Tawfiq al-Hakim's text (printed 267-268) is in the contents but not in the
-- stored text, so it gets no chapter. Guarded: a second run does nothing.

BEGIN;

DO $$
DECLARE
  subj uuid;
  u_essay uuid;
  u_theatre uuid;
  u_tagore uuid;
BEGIN
  SELECT s.id INTO subj
  FROM subjects s JOIN tracks t ON t.id = s.track_id
  WHERE t.code = 'LH' AND s.name = 'أدب عربي';

  IF subj IS NULL THEN
    RAISE EXCEPTION 'LH Arabic subject not found';
  END IF;

  IF EXISTS (SELECT 1 FROM chapters WHERE subject_id = subj
             AND name = 'مَن يعيد توابيتنا إلى الوطن: غادة السمّان') THEN
    RAISE NOTICE 'already applied';
    RETURN;
  END IF;

  -- The literature book must still end at index 31 and grammar start at 32.
  IF (SELECT name FROM chapters WHERE subject_id = subj AND order_index = 31)
       <> 'تعريف المقالة: أسعد نصر الله السكاف'
     OR (SELECT name FROM chapters WHERE subject_id = subj AND order_index = 32)
       <> 'المفعول المطلق' THEN
    RAISE EXCEPTION 'chapter layout is not the expected one; not touching it';
  END IF;

  -- Grammar units 7..9 -> 9..11, chapters 32.. -> 43.. (two steps: unique index).
  UPDATE units SET order_index = order_index + 1000 WHERE subject_id = subj AND order_index >= 7;
  UPDATE units SET order_index = order_index - 1000 + 2 WHERE subject_id = subj AND order_index >= 1000;
  UPDATE chapters SET order_index = order_index + 1000 WHERE subject_id = subj AND order_index >= 32;
  UPDATE chapters SET order_index = order_index - 1000 + 11 WHERE subject_id = subj AND order_index >= 1000;

  SELECT id INTO u_essay FROM units WHERE subject_id = subj AND order_index = 6;
  INSERT INTO units (subject_id, name, order_index)
    VALUES (subj, 'إشكالية المسرح العربي', 7) RETURNING id INTO u_theatre;
  INSERT INTO units (subject_id, name, order_index)
    VALUES (subj, 'الثقافة الأدبية العالمية: جنى الثمار ـ طاغور', 8) RETURNING id INTO u_tagore;

  INSERT INTO chapters (subject_id, unit_id, name, order_index) VALUES
    (subj, u_essay,   'مَن يعيد توابيتنا إلى الوطن: غادة السمّان', 32),
    (subj, u_essay,   'الطبيعة مدرسة دائمة: رشدي المعلوف', 33),
    (subj, u_theatre, 'مقوّمات المسرح العربي', 34),
    (subj, u_theatre, 'تطوّر المسرح العربي في الأدب العربي الحديث', 35),
    (subj, u_theatre, 'دور المسرح في النقد والتوعية والترفيه', 36),
    (subj, u_theatre, 'من قضايا المسرح العربي', 37),
    (subj, u_theatre, 'مأزق المسرح: سعد الله ونّوس', 38),
    (subj, u_tagore,  'الهند في عصر طاغور', 39),
    (subj, u_tagore,  'حياة طاغور وآثاره', 40),
    (subj, u_tagore,  'جنى الثمار', 41),
    (subj, u_tagore,  'شهادات في طاغور', 42);
END $$;

COMMIT;

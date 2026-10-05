-- Civics questions rewritten by today's civics load but left hidden.
-- load-exams corrects a row in place and never un-retires it, so where the new
-- exercise landed on a row an earlier load had hidden (the first question of
-- 2019-2 and 2021-1: true/false, "choose"), the page lost it. A hidden keyed
-- civics row comes back only if its text opens (runs of spaces collapsed, so a
-- copy with words split apart does not) like an exercise of
-- corpus/exams-arabic-civics-20261005.json AND no live row of the same paper
-- opens with the same 30 letters, punctuation, spaces and vowel marks ignored
-- ("صنّف" is "صنف"): an old copy
-- with split words ("اخ ت ر الع بارة") and no colon is the same question and
-- must stay hidden. Local: 6 rows (2026-10-05).
-- Undo: UPDATE questions q SET verified_status = b.verified_status
--   FROM backup_civics_unhide_20261005 b WHERE b.id = q.id;
BEGIN;
CREATE TEMP TABLE heads (p text);
INSERT INTO heads VALUES
  ('1- استنتج المشكلة الرئيسة التي تطرحها ال'),
  ('1- استنتج المشكلة الرئيسية التي تطرحها ا'),
  ('1- قدم كلا من المستندين من حيث نوعه ومصد'),
  ('1- قدّم كلاً من المستندين من حيث نوعه وم'),
  ('1- مهام الجيش الأساسية 2- مهام الجيش عند'),
  ('2- استخرج من المستندين : مصادر الواجبات '),
  ('3- انطلاقاً من معرفتك بأشكال التنظيم الن'),
  ('3- سَخَّ (ي) نوع النقابة الذي تندرج ضمنه'),
  ('3- قدم ثلاث اقتراحات لمواجهة هذه المشكلة'),
  ('3- قدّم ثلاث اقتراحات لمواجهة هذه المشكل'),
  ('أجب ب "صح" أو ب "خطأ"، مصححاً الخطأ في م'),
  ('أجب ب "صح" أو ب "خطأ"، مصححًا الخطأ في م'),
  ('أجب ب « صح » أو ب « خطأ »، مصححاً الخطأ '),
  ('أجب بـ "صح" أو "خطأ" عن العبارات الواردة'),
  ('أجب بـ « صحّ » أو بـ « خطأ » مصححاً الخط'),
  ('أجب بـ" صح " أو "خطأ" مصححاً الخطأ في ما'),
  ('أجب بـ"صح" أو "خطأ" مصححاً الخطأ في ما ي'),
  ('أجب عن العبارات الآتية ب "صح" أو "خطأ" م'),
  ('أجب عن العبارات الآتية بـ "صح" أو "خطأ" '),
  ('إن تعاون الأجهزة الأمنية في ما بينها، وت'),
  ('اختر العبارة أو العبارات الصحيحة في ما ي'),
  ('اربط بين المرجع القضائي في العمود الأول '),
  ('اربط ما ورد في العمود الأول بما يناسبه ف'),
  ('اشطب الدخل في كل من المجموعات الآتية: (ع'),
  ('الصليب الاحمر اللبناني هو جمعية وطنية مس'),
  ('تعتبر نسبة المشاركة في الانتخابات مؤشراً'),
  ('تُعتبَر نسبة المُشارَكة في الانتخابات مؤ'),
  ('حدد العبارة أو العبارات الصحيحة في ما يل'),
  ('حدد العبارة أو العبارات الصّحيحة في ما ي'),
  ('دراسة وضعية مشكلة ( ست علامات "تكافح وسا'),
  ('دراسة وضعية مشكلة (ست علامات " تشهد معظم'),
  ('دراسة وضعية مشكلة (ست علامات "تعاني الهي'),
  ('دراسة وضعية مشكلة (ست علامات أبرمت شركة '),
  ('دراسة وضعية مشكلة (ست علامات بعد تحديد م'),
  ('دراسة وضعية مشكلة (ست علامات بعد تمنع صا'),
  ('دراسة وضعية مشكلة (ست علامات بعد تمنّع ص'),
  ('دراسة وضعية مشكلة (ست علامات تعاني الصحا'),
  ('دراسة وضعية مشكلة (ست علامات خلال فترة ا'),
  ('دراسة وضعية مشكلة (ست علامات يتعرض لبنان'),
  ('دراسة وضعية مُشكلة (ست علامات تعاني الصح'),
  ('صحح الأخطاء الواردة في كل من العبارات ال'),
  ('صدر قانون العمل اللبناني في ٢٣ أيلول ١٩٤'),
  ('صنف العبارات التالية في مجموعتين، وضع عن'),
  ('صنّف العبارات التالية في مجموعتين، وضع ع'),
  ('على مستوى المعارف (ثماني علامات - 1 اختر'),
  ('على مستوى المعارف (ثماني علامات 1- اختر '),
  ('على مستوى المعارف (ثماني علامات ١ - أجب '),
  ('على مستوى تحليل المستندات (ست علامات ---'),
  ('على مستوى تحليل المستندات (ست علامات مست'),
  ('على مستوى تحليل المُستندات (ست علامات مُ'),
  ('على مستوى تحليل مستندات (ست علامات مستند'),
  ('لكل مجتمع نظام دفاعي خاص به. أ. اذكر اثن'),
  ('للمشاركة في الانتخابات شروط متعددة اذكر '),
  ('يؤثر نوع النظام السياسي في عمل وسائل الإ'),
  ('يتعارض "التسويق السياسي " مع مقومات العم'),
  ('يتعارض "التسويق السياسي" مع مقومات العمل'),
  ('يتعرض "التسويق السياسي" مع مقومات العمل '),
  ('يعتبر إقرار قانون عام للبيئة من الخطوات '),
  ('يُعتبر إقرار قانون عام للبيئة من الخطوات'),
  ('٢- مهام الجيش عند إعلان حالة الطوارئ أ- ');
CREATE TABLE backup_civics_unhide_20261005 AS
SELECT r.id, r.verified_status
  FROM questions r JOIN exam_cycles ec ON ec.id = r.source_exam_id JOIN subjects s ON s.id = ec.subject_id
 WHERE s.name = 'تربية وطنية' AND r.verified_status = 'rejected' AND r.source_ref IS NOT NULL
   AND EXISTS (SELECT 1 FROM heads h WHERE left(btrim(regexp_replace(r.content_text, '\s+', ' ', 'g')), 40) = h.p)
   AND NOT EXISTS (SELECT 1 FROM questions l WHERE l.source_exam_id = r.source_exam_id AND l.verified_status <> 'rejected'
                     AND left(regexp_replace(l.content_text, '[^[:alpha:]]+|[ً-ْٰ]', '', 'g'), 30) = left(regexp_replace(r.content_text, '[^[:alpha:]]+|[ً-ْٰ]', '', 'g'), 30));
UPDATE questions q SET verified_status = 'unverified' FROM backup_civics_unhide_20261005 b WHERE b.id = q.id;
SELECT count(*) AS rows_unhidden FROM backup_civics_unhide_20261005;
SELECT ec.title, q.order_index, length(q.content_text) FROM backup_civics_unhide_20261005 b JOIN questions q ON q.id=b.id JOIN exam_cycles ec ON ec.id=q.source_exam_id;
COMMIT;

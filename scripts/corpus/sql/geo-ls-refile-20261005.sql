-- LS geography filed by what each paper's own header says (found 2026-10-05; bac2-38 asked bac2-5c to do it).
--   ls/2004 2/geo.pdf, ls/2008 1/geo.pdf, ls/2009 1/geo.pdf: "فرع العلوم العامة" only, the GS papers. Hidden from LS.
--   ls/2010 2/geo.pdf: "دورة 2009 الاستثنائية / فرع العلوم العامة", GS 2009-2. Hidden from LS (it sat in LS 2009-2).
--   ls/2017 1/geo.pdf: "2017 الاستثنائية / علوم عامة واجتماع واقتصاد", GS+SE session 2. Hidden from LS 2017-1.
--   ls/2017 2/geo_crdp.pdf: "2017 العادية، 17 حزيران / فرع علوم الحياة", LS SESSION 1. Moved to LS 2017-1.
--   ls/2015 1/geo_crdp.pdf, geo_crdp2.pdf: two more copies of the shared paper ls/2015 1/geo.pdf keeps. Hidden.
-- Only LS rows are touched (the same bytes under GS/SE are those tracks' own papers).
-- Undo: UPDATE questions q SET source_exam_id = b.source_exam_id, verified_status = b.verified_status
--   FROM backup_geo_ls_refile_20261005 b WHERE b.id = q.id;
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE ex (sha text, idx text, ord int, act text, paper text);
INSERT INTO ex VALUES
('08397eb3c1bdcbf1a39bf293ea26b388412bda089c0cf780f9cfd7ad562e2c25', '1', 0, 'hide', 'ls/2004 2/geo.pdf'),
('08397eb3c1bdcbf1a39bf293ea26b388412bda089c0cf780f9cfd7ad562e2c25', '2', 1, 'hide', 'ls/2004 2/geo.pdf'),
('08397eb3c1bdcbf1a39bf293ea26b388412bda089c0cf780f9cfd7ad562e2c25', '3', 2, 'hide', 'ls/2004 2/geo.pdf'),
('08397eb3c1bdcbf1a39bf293ea26b388412bda089c0cf780f9cfd7ad562e2c25', '4', 3, 'hide', 'ls/2004 2/geo.pdf'),
('08397eb3c1bdcbf1a39bf293ea26b388412bda089c0cf780f9cfd7ad562e2c25', '5', 4, 'hide', 'ls/2004 2/geo.pdf'),
('08397eb3c1bdcbf1a39bf293ea26b388412bda089c0cf780f9cfd7ad562e2c25', '6', 5, 'hide', 'ls/2004 2/geo.pdf'),
('08397eb3c1bdcbf1a39bf293ea26b388412bda089c0cf780f9cfd7ad562e2c25', '7', 6, 'hide', 'ls/2004 2/geo.pdf'),
('4799a19244813c478b84cd4678107f92467302ea0b5ad1e2b3529b190a0414aa', '1', 0, 'hide', 'ls/2008 1/geo.pdf'),
('4799a19244813c478b84cd4678107f92467302ea0b5ad1e2b3529b190a0414aa', '2', 1, 'hide', 'ls/2008 1/geo.pdf'),
('4799a19244813c478b84cd4678107f92467302ea0b5ad1e2b3529b190a0414aa', '3', 2, 'hide', 'ls/2008 1/geo.pdf'),
('4799a19244813c478b84cd4678107f92467302ea0b5ad1e2b3529b190a0414aa', '4', 3, 'hide', 'ls/2008 1/geo.pdf'),
('4799a19244813c478b84cd4678107f92467302ea0b5ad1e2b3529b190a0414aa', '5', 4, 'hide', 'ls/2008 1/geo.pdf'),
('4799a19244813c478b84cd4678107f92467302ea0b5ad1e2b3529b190a0414aa', '6', 5, 'hide', 'ls/2008 1/geo.pdf'),
('12f1039d1d9726bb2a289df0cee55b35b688f54af8490d9753b5e4473e838057', '1', 0, 'hide', 'ls/2009 1/geo.pdf'),
('12f1039d1d9726bb2a289df0cee55b35b688f54af8490d9753b5e4473e838057', '2', 1, 'hide', 'ls/2009 1/geo.pdf'),
('12f1039d1d9726bb2a289df0cee55b35b688f54af8490d9753b5e4473e838057', '3', 2, 'hide', 'ls/2009 1/geo.pdf'),
('12f1039d1d9726bb2a289df0cee55b35b688f54af8490d9753b5e4473e838057', '4', 3, 'hide', 'ls/2009 1/geo.pdf'),
('12f1039d1d9726bb2a289df0cee55b35b688f54af8490d9753b5e4473e838057', '5', 4, 'hide', 'ls/2009 1/geo.pdf'),
('12f1039d1d9726bb2a289df0cee55b35b688f54af8490d9753b5e4473e838057', '6', 5, 'hide', 'ls/2009 1/geo.pdf'),
('a0e24a1eee41d92e18eacd6b770aac79dd6018937cc47f5e0f1552b96065f5ec', '1', 0, 'hide', 'ls/2010 2/geo.pdf'),
('a0e24a1eee41d92e18eacd6b770aac79dd6018937cc47f5e0f1552b96065f5ec', '2', 1, 'hide', 'ls/2010 2/geo.pdf'),
('a0e24a1eee41d92e18eacd6b770aac79dd6018937cc47f5e0f1552b96065f5ec', '3', 2, 'hide', 'ls/2010 2/geo.pdf'),
('a0e24a1eee41d92e18eacd6b770aac79dd6018937cc47f5e0f1552b96065f5ec', '4', 3, 'hide', 'ls/2010 2/geo.pdf'),
('a0e24a1eee41d92e18eacd6b770aac79dd6018937cc47f5e0f1552b96065f5ec', '5', 4, 'hide', 'ls/2010 2/geo.pdf'),
('a0e24a1eee41d92e18eacd6b770aac79dd6018937cc47f5e0f1552b96065f5ec', '6', 5, 'hide', 'ls/2010 2/geo.pdf'),
('a0e24a1eee41d92e18eacd6b770aac79dd6018937cc47f5e0f1552b96065f5ec', '7', 6, 'hide', 'ls/2010 2/geo.pdf'),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '1', 0, 'hide', 'ls/2017 1/geo.pdf'),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '2', 1, 'hide', 'ls/2017 1/geo.pdf'),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '3', 2, 'hide', 'ls/2017 1/geo.pdf'),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '4', 3, 'hide', 'ls/2017 1/geo.pdf'),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '5', 4, 'hide', 'ls/2017 1/geo.pdf'),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '6', 5, 'hide', 'ls/2017 1/geo.pdf'),
('bf7a7d2a90cfb9586aa2cf7b197dc0fc4093efd87bf427be11c9f12e1946e6eb', '7', 6, 'hide', 'ls/2017 1/geo.pdf'),
('b18a60e0c3cda0b2f512f4909cc220231acface6930769bd15fdab18b72e90cc', '1', 0, 'hide', 'ls/2015 1/geo_crdp.pdf'),
('b18a60e0c3cda0b2f512f4909cc220231acface6930769bd15fdab18b72e90cc', '2', 1, 'hide', 'ls/2015 1/geo_crdp.pdf'),
('b18a60e0c3cda0b2f512f4909cc220231acface6930769bd15fdab18b72e90cc', '3', 2, 'hide', 'ls/2015 1/geo_crdp.pdf'),
('b18a60e0c3cda0b2f512f4909cc220231acface6930769bd15fdab18b72e90cc', '4', 3, 'hide', 'ls/2015 1/geo_crdp.pdf'),
('b18a60e0c3cda0b2f512f4909cc220231acface6930769bd15fdab18b72e90cc', '5', 4, 'hide', 'ls/2015 1/geo_crdp.pdf'),
('b18a60e0c3cda0b2f512f4909cc220231acface6930769bd15fdab18b72e90cc', '6', 5, 'hide', 'ls/2015 1/geo_crdp.pdf'),
('760e69a3e484fb332f3c1de094755bf5825ed74ae8e472b09698c2916c1554ef', '1', 0, 'hide', 'ls/2015 1/geo_crdp2.pdf'),
('760e69a3e484fb332f3c1de094755bf5825ed74ae8e472b09698c2916c1554ef', '2', 1, 'hide', 'ls/2015 1/geo_crdp2.pdf'),
('760e69a3e484fb332f3c1de094755bf5825ed74ae8e472b09698c2916c1554ef', '3', 2, 'hide', 'ls/2015 1/geo_crdp2.pdf'),
('760e69a3e484fb332f3c1de094755bf5825ed74ae8e472b09698c2916c1554ef', '4', 3, 'hide', 'ls/2015 1/geo_crdp2.pdf'),
('760e69a3e484fb332f3c1de094755bf5825ed74ae8e472b09698c2916c1554ef', '5', 4, 'hide', 'ls/2015 1/geo_crdp2.pdf'),
('760e69a3e484fb332f3c1de094755bf5825ed74ae8e472b09698c2916c1554ef', '6', 5, 'hide', 'ls/2015 1/geo_crdp2.pdf'),
('760e69a3e484fb332f3c1de094755bf5825ed74ae8e472b09698c2916c1554ef', '7', 6, 'hide', 'ls/2015 1/geo_crdp2.pdf'),
('8f9a48da5684173d409be34f3cbb030cc7c1f08d550aaa45322838ba0e8003dd', '1', 0, 'move:session1', 'ls/2017 2/geo_crdp.pdf'),
('8f9a48da5684173d409be34f3cbb030cc7c1f08d550aaa45322838ba0e8003dd', '2', 1, 'move:session1', 'ls/2017 2/geo_crdp.pdf'),
('8f9a48da5684173d409be34f3cbb030cc7c1f08d550aaa45322838ba0e8003dd', '3', 2, 'move:session1', 'ls/2017 2/geo_crdp.pdf'),
('8f9a48da5684173d409be34f3cbb030cc7c1f08d550aaa45322838ba0e8003dd', '4', 3, 'move:session1', 'ls/2017 2/geo_crdp.pdf'),
('8f9a48da5684173d409be34f3cbb030cc7c1f08d550aaa45322838ba0e8003dd', '5', 4, 'move:session1', 'ls/2017 2/geo_crdp.pdf'),
('8f9a48da5684173d409be34f3cbb030cc7c1f08d550aaa45322838ba0e8003dd', '6', 5, 'move:session1', 'ls/2017 2/geo_crdp.pdf'),
('8f9a48da5684173d409be34f3cbb030cc7c1f08d550aaa45322838ba0e8003dd', '7', 6, 'move:session1', 'ls/2017 2/geo_crdp.pdf');
CREATE TEMP TABLE r AS
SELECT DISTINCT q.id, q.source_exam_id, e.title, e.subject_id, e.year, e.language, ex.act, ex.paper
  FROM ex CROSS JOIN subjects s
  JOIN tracks t ON t.id = s.track_id AND t.code = 'LS'
  JOIN questions q ON q.source_ref = encode(sha256(convert_to(s.id::text || ':' || ex.sha || ':' || ex.idx || ':' || ex.ord, 'UTF8')), 'hex')
  JOIN exam_cycles e ON e.id = q.source_exam_id
 WHERE q.verified_status <> 'rejected';
SELECT paper, act, title, count(*) FROM r GROUP BY 1, 2, 3 ORDER BY 1;
CREATE TABLE backup_geo_ls_refile_20261005 AS
SELECT q.id, q.source_exam_id, q.verified_status FROM questions q WHERE q.id IN (SELECT id FROM r);
UPDATE questions q SET source_exam_id = t.id
  FROM r JOIN exam_cycles t ON t.subject_id = r.subject_id AND t.year = r.year AND t.language = r.language AND t.session = 'session1'
 WHERE q.id = r.id AND r.act = 'move:session1';
UPDATE questions SET verified_status = 'rejected' WHERE id IN (SELECT id FROM r WHERE act = 'hide');
SELECT e.title, count(*) FILTER (WHERE q.verified_status <> 'rejected') AS shown,
       count(DISTINCT md5(coalesce(q.source_passage, ''))) FILTER (WHERE q.verified_status <> 'rejected') AS document_sets
  FROM exam_cycles e LEFT JOIN questions q ON q.source_exam_id = e.id
 WHERE e.title ~ '^(Geographie|جغرافيا) LS (2004 — session 2|2008 — session 1|2009|2010|2015 — session 1|2017)'
 GROUP BY 1 ORDER BY 1;
COMMIT;

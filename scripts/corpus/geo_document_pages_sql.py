"""SQL that shows geography papers' document pages (geo_document_pages.py) on their first question.

    python scripts/corpus/geo_document_pages_sql.py --tracks GS,SE,LH,LS --exclude "ls/2004 2/geo.pdf" ...

Writes scripts/corpus/sql/geo-doc-pages-20261005.sql. It applies by natural keys, so it runs
the same on a database whose ids differ:

  - the row is the paper's first exercise, by its source_ref:
    sha256("<subject id>:<paper sha256>:<first exercise index>:0"), as load-exams.ts keys it,
    limited to subjects of the given tracks (a paper filed under two tracks has a row in each);
  - each page picture becomes a visual occurrence (paper_sha256, crop_name 'geo-doc-pN'),
    served from public/geo-docs/;
  - on that row only, the visuals active before are set to 'rejected' (backup table), and the
    page pictures are linked as paper_shared, tier human. Later rows keep their own visuals.

Papers whose cut reported a problem are left out: they keep what they show today.
Undo:
  UPDATE question_visuals v SET status = b.status, updated_at = now()
    FROM backup_geo_doc_pages_20261005 b WHERE b.id = v.id;
  DELETE FROM question_visuals WHERE evidence_run = 'geo-doc-pages-2026-10-05';
"""
import argparse, json, sys
from pathlib import Path

RUN = 'geo-doc-pages-2026-10-05'
BACKUP = 'backup_geo_doc_pages_20261005'
sys.stdout.reconfigure(encoding='utf-8')


def first_index(path):
    for f in ('corpus/exams-arabic.json', 'corpus/exams.json'):
        for x in json.loads(Path(f).read_text(encoding='utf-8')):
            if x['path'].replace('\\', '/') == path and x.get('exercises'):
                return [(str(e['index']), order) for order, e in enumerate(x['exercises'])], x['sha256']
    return None, None


def lit(v):
    return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tracks', default='GS,SE,LH')
    ap.add_argument('--exclude', nargs='*', default=[], help='paper paths to leave alone (e.g. misfiled, about to move)')
    a = ap.parse_args()
    tracks = [t.strip().upper() for t in a.tracks.split(',') if t.strip()]
    man = json.loads(Path('corpus/geo-docs/manifest.json').read_text(encoding='utf-8'))
    pics, firsts, skipped = {}, set(), []
    for r in man:
        if r['paper'].split('/')[0].upper() not in tracks:
            continue
        if r['paper'] in a.exclude:
            skipped.append(r['paper'] + ' (excluded)')
            continue
        if r['problems'] or not r['pages']:
            skipped.append(r['paper'])
            continue
        exercises, sha = first_index(r['paper'])
        if exercises is None or sha != r['sha256']:
            skipped.append(r['paper'] + ' (not in the exams files)')
            continue
        # The track of the file's own folder: the same bytes filed under another
        # track (gs/2004 2/geo.pdf = ls/2004 2/geo.pdf) are that folder's business.
        # Every exercise is listed: the page opens on the first one still shown,
        # and on 26 papers exercise 1's row is hidden.
        for idx, order in exercises:
            firsts.add((sha, idx, order, r['paper'].split('/')[0].upper()))
        for p in r['pages']:
            top, bottom = p['box_pt'][1], p['box_pt'][3]
            k = 1.7  # the cutter's render scale, points to pixels
            pics[(sha, f"geo-doc-p{p['page']}")] = (
                sha, f"geo-doc-p{p['page']}", p['page'], 0, int(top * k), p['px'][0], p['px'][1],
                int(p['size'][0] * k), int(p['size'][1] * k), p['page'], p['image'], p['sha256'], p['bytes'])
    pic_rows = ',\n'.join('(' + ', '.join(lit(v) for v in row) + ')' for row in pics.values())
    first_rows = ',\n'.join(f'({lit(s)}, {lit(i)}, {o}, {lit(tr)})' for s, i, o, tr in sorted(firsts))
    n_papers = len({(s, tr) for s, _, _, tr in firsts})
    sql = f"""-- Geography document pages, shown as printed on each paper's first question ({', '.join(tracks)}).
-- Made by scripts/corpus/geo_document_pages_sql.py; pictures in public/geo-docs/ (geo_document_pages.py).
-- {n_papers} papers, {len(pics)} pictures. Undo:
--   UPDATE question_visuals v SET status = b.status, updated_at = now() FROM {BACKUP} b WHERE b.id = v.id;
--   DELETE FROM question_visuals WHERE evidence_run = '{RUN}';
\\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE pics (sha text, crop text, page int, bx int, by int, bw int, bh int, pw int, ph int,
  ro int, key text, hash text, bytes int);
INSERT INTO pics VALUES
{pic_rows};
CREATE TEMP TABLE firsts (sha text, idx text, ord int, track text);
INSERT INTO firsts VALUES
{first_rows};
-- Per paper and track, the first exercise row still shown.
CREATE TEMP TABLE hit AS
SELECT DISTINCT ON (f.sha, f.track, q.source_exam_id) q.id AS question_id, f.sha
  FROM firsts f
  CROSS JOIN subjects s
  JOIN tracks t ON t.id = s.track_id AND t.code = f.track
  JOIN questions q ON q.source_ref = encode(sha256(convert_to(s.id::text || ':' || f.sha || ':' || f.idx || ':' || f.ord, 'UTF8')), 'hex')
 WHERE q.verified_status <> 'rejected'
 ORDER BY f.sha, f.track, q.source_exam_id, q.order_index;
SELECT {n_papers} AS papers, count(*) AS first_rows FROM hit;
INSERT INTO visual_assets (content_hash, media_type, byte_size)
SELECT DISTINCT hash, 'image/jpeg', bytes FROM pics ON CONFLICT (content_hash) DO NOTHING;
INSERT INTO visual_occurrences (asset_id, paper_sha256, crop_name, page, bbox_x, bbox_y, bbox_w, bbox_h,
  page_width, page_height, reading_order, access, storage_key, evidence_run)
SELECT a.id, p.sha, p.crop, p.page, p.bx, p.by, p.bw, p.bh, p.pw, p.ph, p.ro, 'question', p.key, '{RUN}'
  FROM pics p JOIN visual_assets a ON a.content_hash = p.hash
    ON CONFLICT (paper_sha256, crop_name) DO NOTHING;
CREATE TABLE IF NOT EXISTS {BACKUP} (id uuid PRIMARY KEY, status visual_status, saved_at timestamptz DEFAULT now());
INSERT INTO {BACKUP} (id, status)
SELECT v.id, v.status FROM question_visuals v JOIN hit h ON h.question_id = v.question_id
 WHERE v.status = 'active' AND v.evidence_run <> '{RUN}'
    ON CONFLICT (id) DO NOTHING;
UPDATE question_visuals v SET status = 'rejected', updated_at = now()
  FROM hit h WHERE h.question_id = v.question_id AND v.status = 'active' AND v.evidence_run <> '{RUN}';
INSERT INTO question_visuals (question_id, occurrence_id, role, introduced_in_stimulus, structural_confidence,
  geometric_confidence, semantic_confidence, tier, status, evidence_run, updated_at)
SELECT h.question_id, o.id, 'paper_shared', false, 'strong', 'unique', 'contextual', 'human', 'active', '{RUN}', now()
  FROM hit h JOIN visual_occurrences o ON o.paper_sha256 = h.sha AND o.evidence_run = '{RUN}'
    ON CONFLICT (question_id, occurrence_id) DO UPDATE SET status = 'active', updated_at = now();
SELECT count(*) AS linked FROM question_visuals WHERE evidence_run = '{RUN}' AND status = 'active';
COMMIT;
"""
    out = Path('scripts/corpus/sql/geo-doc-pages-20261005.sql')
    out.write_text(sql, encoding='utf-8', newline='\n')
    print(f'{n_papers} papers, {len(pics)} pictures -> {out}; left out {len(skipped)}:')
    for s in skipped:
        print('  ', s)


if __name__ == '__main__':
    main()

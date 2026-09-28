"""Settle the questions the review flagged wrong_subject / wrong_language.

    python scripts/corpus/refile_review_strays.py [--apply]

Philosophy, sociology and economics exist only as Arabic subjects, so a French
or English copy of those papers has no home: it is rejected wherever it sits
(Arabic philosophy, Français, Arabic literature). A stray whose text already
exists in the right subject is a duplicate and is rejected. The few left are
moved to the subject and chapter named in MOVES, chosen by reading them.
Writes corpus/refile-review/strays-receipt.json; --undo is the backup table.
"""
import json, glob, os, subprocess, sys, datetime

APPLY = '--apply' in sys.argv
ROOT = 'corpus/refile-review'
ARABIC_ONLY = ('فلسفة_عامة', 'اجتماع', 'اقتصاد')

# prefix -> (track, subject, chapter order_index). Read one by one, 2026-09-28.
MOVES = {
    'e2ba21b2': ('LH', 'تاريخ', 0),           # Jamal Pasha's measures in Mount Lebanon
    '1b1a0a06': ('LH', 'Chemistry', 9),       # grapefruit-pip oil as an antibiotic
    '10e4f694': ('SE', 'Mathematics', 0),     # turnover table, regression line
    '8abf6ef6': ('SE', 'Mathematics', 13),    # production falling 15% a year
    'c737ca5e': ('SE', 'Mathematics', 15),    # watch testing, conditional probability
    'd12f5a2a': ('SE', 'Mathematics', 4),     # g(x) = (x-1)e^-x + 1
    'a87556e3': ('SE', 'Chemistry', 3),       # alcoholism, malnutrition and vitamins
    'bec28c85': ('SE', 'Life Sciences', 6),   # Zoloft leaflet
}

# Strays in the wrong language whose twin already sits in the right subject.
TWINS = {'7d35f4f5'}  # English exp study under LS Mathematiques; LS Mathematics has it

def psql(sql, js=False):
    r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, capture_output=True, text=True, encoding='utf-8')
    if r.returncode: sys.exit(r.stderr)
    return json.loads(r.stdout.strip() or 'null') if js else r.stdout

reject, move = [], []
for f in sorted(glob.glob(f'{ROOT}/decisions/*.json')):
    name = os.path.basename(f)[:-5]
    for d in json.load(open(f, encoding='utf-8')):
        flag = d.get('flag')
        if flag not in ('wrong_subject', 'wrong_language'):
            continue
        pre = d['id'][:8]
        if pre in MOVES:
            move.append((d['id'], *MOVES[pre]))
        elif flag == 'wrong_language' and not name.endswith(ARABIC_ONLY) and pre not in TWINS:
            print('unhandled wrong_language', name, pre)
        else:
            # French/English copies of Arabic-only subjects, philosophy papers under
            # Français / Arabic literature, history answer keys under philosophy,
            # and strays whose twin already sits in the right subject.
            reject.append(d['id'])

print(f'reject {len(reject)}, move {len(move)}')
if not APPLY:
    sys.exit('dry run. Re-run with --apply.')

stamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
ids = [i for i in reject] + [m[0] for m in move]
lit = lambda s: "'" + s.replace("'", "''") + "'"
stmts = ['BEGIN;',
         f"CREATE TABLE backup_strays_{stamp} AS SELECT id, chapter_id, verified_status FROM questions WHERE id IN ({','.join(map(lit, ids))});",
         f"CREATE TABLE backup_strays_links_{stamp} AS SELECT * FROM question_chapters WHERE question_id IN ({','.join(map(lit, ids))});",
         f"UPDATE questions SET verified_status = 'rejected' WHERE verified_status = 'unverified' AND id IN ({','.join(map(lit, reject))});"]
for qid, track, subject, n in move:
    to = f"(SELECT c.id FROM chapters c JOIN subjects s ON s.id = c.subject_id JOIN tracks t ON t.id = s.track_id WHERE t.code = {lit(track)} AND s.name = {lit(subject)} AND c.order_index = {n})"
    stmts += [f"DELETE FROM question_chapters WHERE question_id = {lit(qid)};",
              f"UPDATE questions SET chapter_id = {to} WHERE id = {lit(qid)};",
              f"INSERT INTO question_chapters (question_id, chapter_id) VALUES ({lit(qid)}, {to});"]
stmts.append('COMMIT;')
psql('\n'.join(stmts))
json.dump({'backup': f'backup_strays_{stamp}', 'rejected': reject, 'moved': [m[0] for m in move]},
          open(f'{ROOT}/strays-receipt.json', 'w'), indent=1)
print(f'done. backup tables backup_strays_{stamp} and backup_strays_links_{stamp}')

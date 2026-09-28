#!/usr/bin/env bash
# One review round: reject rows the reviewers flagged not_a_question (list kept
# in corpus/refile-review/rejected-not-a-question.json), apply the moves, and
# rebuild the cross-track links from a clean base.
set -e
cd "$(dirname "$0")/../.."
PYTHONIOENCODING=utf-8 python - <<'PY'
import json, glob, subprocess
ids = [x['id'] for f in glob.glob('corpus/refile-review/decisions/*.json')
       for x in json.load(open(f, encoding='utf-8')) if x.get('flag') == 'not_a_question']
json.dump(ids, open('corpus/refile-review/rejected-not-a-question.json', 'w'))
sql = "UPDATE questions SET verified_status='rejected' WHERE verified_status='unverified' AND id IN (" + ','.join(f"'{i}'" for i in ids) + ");"
r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At'], input=sql, capture_output=True, text=True)
print(f'not_a_question: {len(ids)} flagged, {r.stdout.strip()} {r.stderr.strip()}')
PY
PYTHONIOENCODING=utf-8 python scripts/corpus/refile_review_apply.py --apply | grep -vE "move=0|^\s*$" | grep -E "move=|moved|skipped"
npm run --silent corpus:share-tracks -- --undo | tail -1
npm run --silent corpus:share-tracks | grep -E "verified|MISSING|error" || true

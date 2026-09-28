"""Plan links from Arabic geography document crops to the questions that use them.

    python scripts/corpus/geo_maps_plan.py

A geography paper prints ONE set of documents (maps, graphs, tables) and the
loader splits the paper into many small question rows ("حدّد طبيعة المستند",
"من خلال المستند رقم (1)"). C3 looked for a single owner per crop, found a
dozen candidates it could not tell apart (the Arabic document numbers were not
read), and left 116 crops UNRESOLVED — so the maps reached neither the student
nor the tutor. Here a crop belongs to the paper: every question row of that
paper that refers to its documents. Question rows are found through their exam cycle (track, year, session).

Writes corpus/geo-maps/plan.json. Read-only.
"""
import json, re, subprocess

def psql(sql):
    r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At'],
                       input=sql, capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(r.stdout.strip() or 'null')

own = json.load(open('corpus/.mapping/figure-ownership.json', encoding='utf-8'))
rows = own if isinstance(own, list) else next(v for v in own.values() if isinstance(v, list))
geo = {r['occurrenceId'].split('/')[1]: r for r in rows if r.get('family') == 'geography-ar'}

occ = psql("select json_agg(json_build_object('id', o.id, 'crop', o.crop_name, 'sha', o.paper_sha256, 'page', o.page,"
           " 'access', o.access, 'key', o.storage_key, 'order', o.reading_order,"
           " 'linked', exists (select 1 from question_visuals v where v.occurrence_id = o.id)))"
           " from visual_occurrences o where o.crop_name in (" + ','.join(f"'{c}'" for c in geo) + ")")
# A crop's paper paths ("gs/2004 2/geo.pdf", "ls/2004 2/geo.pdf") name the
# track, year and session; every geography question points at its exam cycle
# by the same three. (source_ref could not be used: only 71 of 134 geography
# rows recompute from either exam file.)
cyc = psql("""select json_agg(json_build_object('track', lower(t.code), 'year', ec.year, 'session', ec.session,
  'questions', (select json_agg(json_build_object('id', q.id, 'text', q.content_text)) from questions q
                 where q.source_exam_id = ec.id and q.verified_status <> 'rejected')))
  from exam_cycles ec join subjects s on s.id = ec.subject_id join tracks t on t.id = s.track_id where s.name = 'جغرافيا'""")
by_cycle = {(c['track'], c['year'], c['session']): c['questions'] or [] for c in cyc}
DOC = re.compile(r'(المستند|المستندات|مستند|الخريطة|خريطة|الرسم|الجدول|الشكل)')

def questions_for(papers):
    out = []
    for path in papers or []:
        m = re.match(r'(\w+)[/\\](\d{4})\s+(\d)', path)
        if not m: continue
        for q in by_cycle.get((m.group(1).lower(), int(m.group(2)), f'session{m.group(3)}'), []):
            if DOC.search(q['text']) and q['id'] not in out: out.append(q['id'])
    return out

plan = []
for o in occ:
    r = geo[o['crop']]
    plan.append({**o, 'path': r['crop'], 'papers': r.get('papers'), 'c3': r.get('semanticConfidence'),
                 'questions': questions_for(r.get('papers'))})
json.dump(plan, open('corpus/geo-maps/plan.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
from collections import Counter
print('crops', len(plan), Counter(p['access'] for p in plan), 'already linked', sum(p['linked'] for p in plan))
print('question-access crops with questions to link:', sum(1 for p in plan if p['access'] == 'question' and p['questions'] and not p['linked']))
print('papers', len({p['sha'] for p in plan}), 'questions reachable', len({q for p in plan for q in p['questions']}))

"""Export one review packet per subject: its chapters (with the book's own
headings and opening text) and its unverified past-exam questions.

    python scripts/corpus/refile_review_export.py

Writes corpus/refile-review/packets/<track>__<subject>.json. Read-only on the DB.
"""
import json, re, subprocess, pathlib

OUT = pathlib.Path('corpus/refile-review/packets')
OUT.mkdir(parents=True, exist_ok=True)

def sql(q):
    r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At'],
                       input=q, capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(r.stdout.strip() or 'null')

subjects = sql("""
select json_agg(x) from (
  select s.id, s.name, s.language, t.code track
    from subjects s join tracks t on t.id = s.track_id
   where exists (select 1 from questions q join chapters c on c.id = q.chapter_id
                  where c.subject_id = s.id and q.source_type = 'past_exam' and q.verified_status = 'unverified')
) x""")

for s in subjects:
    chapters = sql(f"""
    select json_agg(x order by x.order_index) from (
      select c.id, c.order_index, c.name, u.name unit,
             (select json_agg(t.content_text order by t.p) from (
                select cc.content_text, cc.source_page_from p
                  from chapter_content_chunks l join content_chunks cc on cc.id = l.chunk_id
                 where l.chapter_id = c.id order by cc.source_page_from, cc.id limit 40) t) chunks
        from chapters c left join units u on u.id = c.unit_id
       where c.subject_id = '{s['id']}') x""") or []
    for c in chapters:
        texts = c.pop('chunks') or []
        heads = []
        for t in texts:
            for h in re.findall(r'^#{1,4}\s*(.+)$', t, flags=re.M):
                h = re.sub(r'\s+', ' ', h).strip()[:90]
                if h and h not in heads and not h.lower().startswith(('exemple', 'example', 'solution')):
                    heads.append(h)
        c['book_headings'] = heads[:25]
        opening = re.sub(r'\s+', ' ', texts[0]) if texts else ''
        c['book_opening'] = opening[:400]
        c['has_book_text'] = bool(texts)
    questions = sql(f"""
    select json_agg(x) from (
      select q.id, c.order_index current_chapter, left(regexp_replace(coalesce(nullif(q.content_latex,''), q.content_text), '\s+', ' ', 'g'), 1400) text
        from questions q join chapters c on c.id = q.chapter_id
       where c.subject_id = '{s['id']}' and q.source_type = 'past_exam' and q.verified_status = 'unverified'
       order by q.id) x""") or []
    name = f"{s['track']}__{s['name']}".replace(' ', '_')
    (OUT / f'{name}.json').write_text(json.dumps({
        'subject_id': s['id'], 'subject': s['name'], 'track': s['track'], 'language': s['language'],
        'chapters': [{'n': c['order_index'], 'name': c['name'], 'unit': c['unit'], 'has_book_text': c['has_book_text'],
                      'book_headings': c['book_headings'], 'book_opening': c['book_opening'], 'id': c['id']} for c in chapters],
        'questions': questions}, ensure_ascii=False, indent=1), encoding='utf-8')
    print(name, len(chapters), len(questions))

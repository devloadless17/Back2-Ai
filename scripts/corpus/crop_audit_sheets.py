"""Build the sheets for a gated-crop audit, one subject family at a time.

    python scripts/corpus/crop_audit_sheets.py <family> [--seed N]

family: chemistry | biology | maths | physics. English and French editions are
one family: the crops come from the same detector on the same kind of paper.

Samples 50 distinct GATED crops (all of them if there are fewer), with a fixed
seed so the sample is decided before anyone looks. For each it writes
corpus/crop-audit/<family>/NN.png: the page with the crop boxed in red, the
crop itself at full size, and the opening of the exercise it is attached to.
The list goes to corpus/crop-audit/<family>/sample.json; verdicts are written by
hand into verdicts.json next to it.

The pass rule is the pre-registered one in VISUAL-EVIDENCE-MODEL.md: at most 1
error in 50. A crop is an error if a student could not use it: part of the
figure cut off, a garbled or wrong figure, a fragment with no meaning on its
own, or a figure that belongs to another exercise.
"""
import json, random, subprocess, sys, textwrap
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path.cwd()
FAMILIES = {
    'chemistry': ('Chemistry', 'Chimie'),
    'biology': ('Life Sciences', 'Sciences de la vie'),
    'maths': ('Mathematics', 'Mathematiques'),
    'physics': ('Physics', 'Physique'),
}
family = sys.argv[1]
seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 20260928
OUT = ROOT / 'corpus/crop-audit' / (family + (f"-{sys.argv[sys.argv.index('--tag') + 1]}" if '--tag' in sys.argv else ''))
OUT.mkdir(parents=True, exist_ok=True)

names = ','.join("'" + n + "'" for n in FAMILIES[family])
q = f"""
select json_agg(r order by r.occ) from (
  select vo.id occ, vo.paper_sha256 sha, vo.crop_name crop, vo.page,
         vo.bbox_x x, vo.bbox_y y, vo.bbox_w w, vo.bbox_h h, vo.page_width pw, vo.page_height ph,
         min(s.name) subject, min(t.code) track, min(q.source_ref) ref,
         left(min(q.content_text), 500) text
    from question_visuals qv
    join visual_occurrences vo on vo.id = qv.occurrence_id
    join questions q on q.id = qv.question_id
    join chapters c on c.id = q.chapter_id
    join subjects s on s.id = c.subject_id
    join tracks t on t.id = s.track_id
   where qv.tier = 'gated' and s.name in ({names})
   group by vo.id
) r"""
r = subprocess.run(['docker', 'exec', '-i', 'bac2-db', 'psql', '-U', 'bac2', '-d', 'bac2', '-At'],
                   input=q, capture_output=True, text=True, encoding='utf-8', check=True)
rows = json.loads(r.stdout.strip() or '[]')
# Fragments stay pending whatever the audit says, so they are not what is audited.
frag_file = ROOT / 'corpus/.mapping/crop-fragments.json'
if frag_file.exists():
    frags = {(f['paperSha256'], f['cropName']) for f in json.load(open(frag_file, encoding='utf-8'))}
    rows = [x for x in rows if (x['sha'], x['crop']) not in frags]
random.Random(seed).shuffle(rows)
sample = rows if '--all' in sys.argv else rows[:50]
print(f'{family}: {len(rows)} gated crops, sampling {len(sample)} (seed {seed})')

paths = {e['sha256']: e['path'] for e in json.load(open(ROOT / 'corpus/exams.json', encoding='utf-8'))}
try:
    font = ImageFont.truetype('arial.ttf', 22)
except OSError:
    font = ImageFont.load_default()

for i, s in enumerate(sample, 1):
    pdf = pdfium.PdfDocument(ROOT / 'corpus/exams' / paths[s['sha']])
    page = pdf[s['page'] - 1]
    pw, ph = page.get_size()
    scale = (s['pw'] or pw * 250 / 72) / pw
    img = page.render(scale=scale).to_pil().convert('RGB')
    d = ImageDraw.Draw(img)
    d.rectangle([s['x'], s['y'], s['x'] + s['w'], s['y'] + s['h']], outline=(230, 0, 0), width=8)
    page_img = img.resize((int(img.width * 1100 / img.height), 1100))

    crop = Image.open(ROOT / 'corpus/text' / s['sha'] / 'figures' / f"{s['crop']}.jpg").convert('RGB')
    if crop.width > 1000:
        crop = crop.resize((1000, int(crop.height * 1000 / crop.width)))

    head = f"#{i:02d}  {s['subject']} {s['track']}  {paths[s['sha']]}  p.{s['page']}  crop {s['crop']}"
    body = textwrap.fill(' '.join(s['text'].split()), 95)
    th = 40 + 26 * (body.count('\n') + 1)
    W = page_img.width + 30 + max(crop.width, 1000)
    H = max(page_img.height, th + crop.height + 20)
    sheet = Image.new('RGB', (W, H), 'white')
    sheet.paste(page_img, (0, 0))
    x0 = page_img.width + 30
    d = ImageDraw.Draw(sheet)
    d.text((x0, 5), head, fill='black', font=font)
    d.multiline_text((x0, 40), body, fill=(60, 60, 60), font=font, spacing=4)
    sheet.paste(crop, (x0, th + 10))
    d.rectangle([x0 - 2, th + 8, x0 + crop.width + 1, th + 11 + crop.height], outline=(0, 120, 255), width=2)
    sheet.save(OUT / f'{i:02d}.png')
    s['sheet'] = f'{i:02d}.png'
    s['paper'] = paths[s['sha']]

json.dump({'family': family, 'seed': seed, 'population': len(rows), 'sample': sample},
          open(OUT / 'sample.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

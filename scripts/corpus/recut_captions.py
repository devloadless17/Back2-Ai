"""
Grows a gated figure crop to take in its own caption, and marks crops too small
to stand on their own.

    python scripts/corpus/recut_captions.py                 # report only
    python scripts/corpus/recut_captions.py --sheets        # + before/after pictures in corpus/crop-audit/recut/
    python scripts/corpus/recut_captions.py --apply         # rewrite the .jpg files, write the lists
    python scripts/corpus/recut_captions.py --undo          # put every original .jpg back

WHY. The 2026-09-28 audits of the gated crops failed in chemistry (8 in 50),
maths and biology, and nearly every error was one of two kinds:

  - The panel's own label sits just outside Mathpix's box. "Curve c", "Setup (a)",
    "Graphe b" are printed under their panel, and the question says "choose curve
    a, b or c". A crop without the label cannot be answered from.
  - A piece cut out of something larger: a lone arrow from a one-line scheme, one
    arrow from a variation table. Nothing to read on its own.

THE LABEL IS FOUND IN THE PDF'S OWN TEXT LAYER, NOT GUESSED FROM PIXELS. Every
paper these crops come from is a born-digital PDF, so the words and their boxes
are there. Measured on the 80 audited crops, the missing labels are short lines
(under 25 characters) within 55px under the box and centred on it; the good crops
have either nothing there or the start of a long sentence. So a line is taken in
only when it is:

  BELOW   within 55px of the bottom, centred over the crop, at most 24
          characters, and not the start of a numbered question ("2.1-", "b)").
          Up to two such lines, so axis numbers and then the caption both come in.
  ABOVE   within 45px of the top, same shape, and not a "Document N" caption
          (in these papers that belongs to the figure ABOVE) or a lead-in ending
          in ":". This is the table heading over a karyotype cell ("Père : Riad").
  ACROSS  a short line the box already cuts through ("Nouvelles protéines" cut in
          half, axis numbers cut at the bottom): at least 20% of it inside.

A line is skipped if taking it would run the box into another crop on the page.
The new box always contains the old one, so this can add a label and never take
anything away.

FRAGMENTS. A crop smaller than 15,000 px² (at the stored ~250 dpi) is listed in
corpus/.mapping/crop-fragments.json, and the backfill keeps it PENDING, so the
student sees the whole page instead of an arrow. The two audited fragments were
8,432 and 6,048 px²; the smallest good crop in the audit was 51,712.

AFTERWARDS the image hashes no longer match figure-candidates.json, and the
backfill refuses a crop whose bytes changed. Re-run, in order:
    python scripts/corpus/figure_candidates.py
    python scripts/corpus/figure_ownership.py
    npm run corpus:visuals -- --apply --confirm-db <db>

SCOPE. Gated and review crops outside physics. The automatic tier is live and
is not touched; physics passed its audit on the crops as they were cut.

TABLE CELLS. A crop Mathpix placed inside a table of two or more columns is a
cell, not a figure (a karyotype under "Mère : Samar", a recording under "I1"),
and is listed as a fragment, unless the whole-image step below made it at
least twice as big, in which case it is now the complete picture.

WHOLE IMAGE. Before the caption step, a crop that covers only part of an image
the PDF holds whole (half a variation table, one of two setups drawn as one
picture) takes the whole image, trimmed above and below any running text drawn
over its margin. Two panels that become the same image for the same questions
are one figure: the first in reading order is kept, the other held back.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")

APPLY = "--apply" in sys.argv
UNDO = "--undo" in sys.argv
SHEETS = "--sheets" in sys.argv
ROOT = Path.cwd()
EXAMS = ROOT / "corpus/exams.json"
BACKUP = ROOT / "corpus/crop-audit/backup-jpg"
RECEIPT = ROOT / "corpus/.mapping/crop-recut-captions.json"
FRAGMENTS = ROOT / "corpus/.mapping/crop-fragments.json"
SHEET_DIR = ROOT / "corpus/crop-audit/recut"

BELOW_GAP = 55
ABOVE_GAP = 70
MAX_LABEL = 24
MAX_ACROSS = 30
ACROSS_INSIDE = 0.20
FRAGMENT_AREA = 15_000
#: Pieces found by eye in an audit that no rule here can see: Mathpix boxed one
#: cell of a table but wrote it as the whole captioned document, so the text
#: shows no table around it.
REVIEWED_PIECES = {
    "e0f80dc29c3e1e5e": "I1 cell of the recordings table (lh/2009 1/bio_en.pdf, Document 2)",
    "8c4a3c5f72f4f45b": "I1 cell of the recordings table (se/2009 1/bio_en.pdf, Document 2)",
}
#: A crop is a piece of an embedded image when that image is this much bigger.
WHOLE_IMAGE_RATIO = 1.2
#: ...or when the drawn frame around it is this much bigger.
WHOLE_FRAME_RATIO = 1.5
#: Two runs of text on one line are one segment when this close.
JOIN_GAP = 30

NUMBERED = re.compile(r"^\s*(\d+(\.\d+)*\s*[-.)–]|[a-h]\s*[-)–])")
DOC_CAPTION = re.compile(r"^\s*doc", re.I)
#: A page number: "2 / 4", "Page 3", or a bare number near the foot of the page.
PAGE_NUMBER = re.compile(r"^\s*(page\s*)?\d+\s*((/|de|of)\s*\d+)?\s*$", re.I)
#: A sign row of a variation table: only signs, zeros and digits, at least one sign.
#: What marks a variation table nearby: its derivative row ("f'(x)") or an
#: infinity, either as "∞" or as the Symbol-font glyph U+F0A5 some papers use.
DERIVATIVE_ROW = re.compile(r"[a-zA-Z]\s*['’′]\s*\(\s*x\s*\)|∞|")
SIGN_ROW = re.compile(r"^[\s+\-–−0-9.,]*[+\-–−][\s+\-–−0-9.,]*$")

QUERY = """
select json_agg(r) from (
  select vo.id, vo.paper_sha256 sha, vo.crop_name crop, vo.page,
         vo.bbox_x x, vo.bbox_y y, vo.bbox_w w, vo.bbox_h h, vo.page_width pw, vo.reading_order ord,
         array_agg(distinct qv.question_id order by qv.question_id) questions
    from question_visuals qv join visual_occurrences vo on vo.id = qv.occurrence_id
    join questions q on q.id = qv.question_id
    join chapters c on c.id = q.chapter_id
    join subjects s on s.id = c.subject_id
   where qv.tier in ('gated', 'review')
     and not exists (select 1 from question_visuals auto
                      where auto.occurrence_id = vo.id and auto.tier = 'automatic')
   group by vo.id
  -- Physics passed its audit on the crops as Mathpix cut them; leave them so.
  having bool_and(s.name not in ('Physics', 'Physique'))
) r"""
PAGE_CROPS = """
select json_agg(r) from (
  select paper_sha256 sha, page, crop_name crop, bbox_x x, bbox_y y, bbox_w w, bbox_h h
    from visual_occurrences
) r"""


def psql(q):
    out = subprocess.run(["docker", "exec", "-i", "bac2-db", "psql", "-U", "bac2", "-d", "bac2", "-At"],
                         input=q, capture_output=True, text=True, encoding="utf-8", check=True).stdout.strip()
    return json.loads(out or "[]") or []


def crop_file(sha, crop):
    return ROOT / "corpus/text" / sha / "figures" / f"{crop}.jpg"


def undo():
    n = 0
    for f in BACKUP.glob("*/*.jpg"):
        shutil.copyfile(f, crop_file(f.parent.name, f.stem))
        n += 1
    for f in (RECEIPT, FRAGMENTS):
        f.unlink(missing_ok=True)
    print(f"  restored {n} original crops; removed the receipt and the fragment list")
    print("  Now re-run figure_candidates.py, figure_ownership.py and corpus:visuals.")


def segments(page, k, H):
    """The page's text as line segments in page pixels: (x0, y0, x1, y1, text)."""
    tp = page.get_textpage()
    runs = []
    for i in range(tp.count_rects()):
        l, b, r, t = tp.get_rect(i)
        text = tp.get_text_bounded(l, b, r, t).strip()
        if text:
            runs.append([l * k, (H - t) * k, r * k, (H - b) * k, text])
    runs.sort(key=lambda s: (round((s[1] + s[3]) / 2 / 8), s[0]))
    out = []
    for s in runs:
        p = out[-1] if out else None
        if p:
            overlap = min(p[3], s[3]) - max(p[1], s[1])
            if overlap > 0.5 * min(p[3] - p[1], s[3] - s[1]) and 0 <= s[0] - p[2] <= JOIN_GAP:
                p[0], p[1], p[2], p[3] = min(p[0], s[0]), min(p[1], s[1]), max(p[2], s[2]), max(p[3], s[3])
                p[4] = f"{p[4]} {s[4]}"
                continue
        out.append(list(s))
    return out


def intersects(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def union(a, s):
    return (min(a[0], s[0]), min(a[1], s[1]), max(a[2], s[2]), max(a[3], s[3]))


def centred(box, s):
    cx = (s[0] + s[2]) / 2
    return box[0] - 10 <= cx <= box[2] + 10 and (s[2] - s[0]) <= (box[2] - box[0]) + 40


def running(s, box, segs):
    """True when s is a piece of running text rather than a label. The PDF splits
    a sentence into short runs around every formula, so a short piece alone
    proves nothing: follow the text joined to s along its line (gaps up to 60px,
    so a superscript or a formula does not break it; a column gap does) and call
    it running when that stretch goes past the crop's sides or is too long for a
    label."""
    band = [t for t in segs if min(t[3], s[3]) - max(t[1], s[1]) > 0]
    band.sort(key=lambda t: t[0])
    lo, hi, grown = s[0], s[2], True
    stretch = [s]
    while grown:
        grown = False
        for t in band:
            if t not in stretch and (0 <= t[0] - hi <= 60 or 0 <= lo - t[2] <= 60 or (t[0] < hi and t[2] > lo)):
                stretch.append(t)
                lo, hi, grown = min(lo, t[0]), max(hi, t[2]), True
    if lo < box[0] - 40 or hi > box[2] + 40:
        return True
    return sum(len(t[4]) for t in stretch) > MAX_LABEL


def whole_image(box, page, k, H, segs):
    """The embedded image the crop is a piece of, if any.

    Mathpix boxes what it sees, and sometimes sees one panel of a figure the
    PDF holds as a single image: half a variation table, one of two setups.
    When one image object covers most of the crop and is clearly bigger than
    it, the figure is that image. Its box is trimmed above and below any
    running text drawn over it (some papers print the questions on the
    image's white margin), so only the picture and its labels come along."""
    ca = (box[2] - box[0]) * (box[3] - box[1])
    best = None
    for o in page.get_objects(max_depth=5):
        if o.type != pdfium_raw.FPDF_PAGEOBJ_IMAGE:
            continue
        l, b, r, t = o.get_bounds()
        im = (l * k, (H - t) * k, r * k, (H - b) * k)
        iw = max(0, min(box[2], im[2]) - max(box[0], im[0]))
        ih = max(0, min(box[3], im[3]) - max(box[1], im[1]))
        ia = (im[2] - im[0]) * (im[3] - im[1])
        if iw * ih >= 0.5 * ca and ia >= WHOLE_IMAGE_RATIO * ca and (best is None or ia > best[0]):
            best = (ia, im)
    if not best:
        return None
    im = list(best[1])
    frame = tuple(best[1])  # "running text" is judged against the picture, not the piece
    for s in segs:
        inside = s[0] < im[2] and s[2] > im[0] and s[1] < im[3] and s[3] > im[1]
        if not inside or not running(s, frame, segs):
            continue
        if s[1] >= box[3]:
            im[3] = min(im[3], s[1] - 4)
        elif s[3] <= box[1]:
            im[1] = max(im[1], s[3] + 4)
    im = union(tuple(im), box)
    return tuple(int(round(v)) for v in im)


_TAB_OPEN = r"\begin{tabular}"
_TAB_CLOSE = r"\end{tabular}"
_mmd_cache = {}


def table_columns(sha, crop):
    """The columns of the innermost Mathpix table the crop sits in, or 0.

    Mathpix writes a table as \begin{tabular}{|l|l|...}, and puts a figure
    printed in a table cell inside it. A one-column table is only layout (a
    graph with its axis title stacked above it); two or more columns is a real
    table: karyotypes side by side, recordings per intensity, a variation
    table. A cell of one is not a figure: its meaning is in the row and column
    headings around it, so the student is shown the page instead."""
    if sha not in _mmd_cache:
        f = ROOT / "corpus/text" / sha / "document.mmd"
        _mmd_cache[sha] = f.read_text(encoding="utf-8") if f.exists() else ""
    text = _mmd_cache[sha]
    at = text.find(f"figures/{crop}.")
    if at < 0:
        return 0
    most, depth_open = 0, []
    i = 0
    while True:
        o = text.find(_TAB_OPEN, i)
        c = text.find(_TAB_CLOSE, i)
        if o < 0 and c < 0:
            break
        if o >= 0 and (c < 0 or o < c):
            if o > at:
                break
            spec_start = text.find("{", o + len(_TAB_OPEN))
            spec_end = text.find("}", spec_start)
            spec = text[spec_start + 1:spec_end]
            depth_open.append(sum(spec.count(ch) for ch in "lcrp"))
            i = o + len(_TAB_OPEN)
        else:
            if c > at:
                break
            if depth_open:
                depth_open.pop()
            i = c + len(_TAB_CLOSE)
    # The innermost table decides: a figure in a one-column box inside a QCM
    # row is still a figure; a picture straight in a karyotype row is a cell.
    return depth_open[-1] if depth_open else 0


def whole_frame(box, page, k, H, segs, others):
    """The drawn frame the crop is a piece of, if any.

    A document is often printed inside a ruled box, and Mathpix sometimes
    boxes only one panel of it ("Control lot A" but not "Treated lot B" beside
    it). When the smallest drawn rectangle around the crop is clearly bigger
    than the crop, holds no running text (so it is a document frame, not a
    page border or a question box) and no crop of another figure, the figure
    is that frame."""
    ca = (box[2] - box[0]) * (box[3] - box[1])
    best = None
    for o in page.get_objects(max_depth=5):
        if o.type != pdfium_raw.FPDF_PAGEOBJ_PATH:
            continue
        l, b, r, t = o.get_bounds()
        fr = (l * k, (H - t) * k, r * k, (H - b) * k)
        if not (fr[0] <= box[0] + 8 and fr[1] <= box[1] + 8 and fr[2] >= box[2] - 8 and fr[3] >= box[3] - 8):
            continue
        fa = (fr[2] - fr[0]) * (fr[3] - fr[1])
        if fa < WHOLE_FRAME_RATIO * ca or fa > 6 * ca:
            continue
        if best is None or fa < best[0]:
            best = (fa, fr)
    if not best:
        return None
    fr = best[1]
    inside = lambda q: q[0] >= fr[0] - 5 and q[2] <= fr[2] + 5 and q[1] >= fr[1] - 5 and q[3] <= fr[3] + 5
    if any(inside(s) and running(s, fr, segs) for s in segs):
        return None
    if any(inside(o) for o in others):
        return None
    return tuple(int(round(v)) for v in union(fr, box))


def grow(box, segs, others, W, H):
    """Returns the grown box and the text lines it took in."""
    taken = []

    def fits(nb):
        return 0 <= nb[0] and 0 <= nb[1] and nb[2] <= W and nb[3] <= H and not any(
            intersects(nb, o) and not intersects(box0, o) for o in others)

    box0 = box

    def wordless(s):
        # A label has a letter in it; a bare number under a figure is the next
        # table row or an axis value, not its caption.
        return not re.search(r"[^\W\d_]", s[4])

    def page_number(s):
        return PAGE_NUMBER.match(s[4]) and s[1] > 0.88 * H

    # A crop with a variation table's sign row on its edge is a piece of that
    # table: the student needs the whole table, which the page fallback shows.
    table_near = any(DERIVATIVE_ROW.search(t[4]) and intersects((box[0] - 600, box[1] - 400, box[2] + 600, box[3] + 400), t)
                     for t in segs)
    for s in segs if table_near else []:
        near = (0 <= s[1] - box[3] <= BELOW_GAP or 0 <= box[1] - s[3] <= ABOVE_GAP
                or (intersects(box, s) and not (s[0] >= box[0] and s[2] <= box[2] and s[1] >= box[1] and s[3] <= box[3])))
        if near and centred(box, s) and SIGN_ROW.match(s[4]) and not running(s, box, segs):
            return box, [("fragment", s[4])]
    # ACROSS: a short line the box already cuts through.
    for s in segs:
        area = (s[2] - s[0]) * (s[3] - s[1]) or 1
        iw = max(0, min(s[2], box[2]) - max(s[0], box[0]))
        ih = max(0, min(s[3], box[3]) - max(s[1], box[1]))
        inside = s[0] >= box[0] and s[2] <= box[2] and s[1] >= box[1] and s[3] <= box[3]
        if not inside and iw * ih / area >= ACROSS_INSIDE and len(s[4]) <= MAX_ACROSS:
            nb = union(box, s)
            if fits(nb):
                box, taken = nb, taken + [("across", s[4])]
                if "--debug" in sys.argv:
                    print(f"      across {iw * ih / area:.2f} {s[4]!r}")
    # BELOW: up to two short centred lines.
    for _ in range(2):
        cands = [s for s in segs if s[1] >= box[3] - 5 and s[1] - box[3] <= BELOW_GAP and centred(box, s)
                 and len(s[4]) <= MAX_LABEL and not NUMBERED.match(s[4]) and not running(s, box, segs)
                 and not page_number(s) and not wordless(s)]
        cands = [s for s in cands if fits(union(box, s))]
        if not cands:
            break
        top = min(s[1] for s in cands)
        row = [s for s in cands if s[1] - top < 15]
        for s in row:
            box = union(box, s)
        taken += [("below", s[4]) for s in row]
    def hangs(s, depth=3):
        # The subscript of a "lim" or a sum is its own short run just under a
        # sentence ("x→1" under "lim", then "x>1" under that); a heading has
        # clear space above it or another heading.
        return depth > 0 and any(
            0 <= s[1] - t[3] <= 25 and t[0] < s[2] and t[2] > s[0] and (running(t, box, segs) or hangs(t, depth - 1))
            for t in segs if t is not s)

    # ABOVE: a short heading, up to two lines (table headings wrap).
    for _ in range(2):
        cands = [s for s in segs if s[3] <= box[1] + 5 and box[1] - s[3] <= ABOVE_GAP and centred(box, s)
                 and len(s[4]) <= MAX_LABEL and not NUMBERED.match(s[4]) and not DOC_CAPTION.match(s[4])
                 and not s[4].rstrip().endswith((":", ".")) and not running(s, box, segs) and not wordless(s)
                 and not hangs(s)]
        cands = [s for s in cands if fits(union(box, s))]
        if not cands:
            break
        bottom = max(s[3] for s in cands)
        row = [s for s in cands if bottom - s[3] < 15]
        for s in row:
            box = union(box, s)
        taken += [("above", s[4]) for s in row]
    if taken:
        pad = 6  # the text box is tight on the glyphs; leave a little white
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(W, box[2] + pad), min(H, box[3] + pad))
        box = union(box, box0)
    return tuple(int(round(v)) for v in box), taken


def main():
    if UNDO:
        return undo()
    rows = psql(QUERY)
    by_page = {}
    for o in psql(PAGE_CROPS):
        by_page.setdefault((o["sha"], o["page"]), []).append(o)
    paths = {e["sha256"]: e["path"] for e in json.loads(EXAMS.read_text(encoding="utf-8"))}

    pages, grown, fragments, skipped, writes = {}, [], [], [], []
    for r in rows:
        f = crop_file(r["sha"], r["crop"])
        pdf = ROOT / "corpus/exams" / paths.get(r["sha"], "?")
        if not f.exists() or not pdf.exists():
            skipped.append((r["crop"], "no crop file" if not f.exists() else "no pdf"))
            continue
        if r["w"] * r["h"] < FRAGMENT_AREA:
            fragments.append({"paperSha256": r["sha"], "cropName": r["crop"], "w": r["w"], "h": r["h"],
                              "why": "smaller than a figure"})
            continue
        if r["crop"] in REVIEWED_PIECES:
            fragments.append({"paperSha256": r["sha"], "cropName": r["crop"], "w": r["w"], "h": r["h"],
                              "why": "reviewed: " + REVIEWED_PIECES[r["crop"]]})
            continue
        with Image.open(f) as im:
            recut_before = abs(im.width - r["w"]) > 2 or abs(im.height - r["h"]) > 2
        if recut_before and table_columns(r["sha"], r["crop"]) >= 2:
            fragments.append({"paperSha256": r["sha"], "cropName": r["crop"], "w": r["w"], "h": r["h"],
                              "why": f"cell of a {table_columns(r['sha'], r['crop'])}-column table"})
            continue
        if recut_before:
            skipped.append((r["crop"], f"already re-cut by recut_clipped_figures.py"))
            continue

        key = (r["sha"], r["page"])
        if key not in pages:
            page = pdfium.PdfDocument(str(pdf))[r["page"] - 1]
            W, H = page.get_size()
            k = r["pw"] / W
            pages[key] = (page.render(scale=k).to_pil().convert("RGB"), segments(page, k, H), page, k, H)
        image, segs, page, k, H = pages[key]
        box = (r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
        whole = whole_image(box, page, k, H, segs)
        others = [(o["x"], o["y"], o["x"] + o["w"], o["y"] + o["h"])
                  for o in by_page.get(key, []) if o["crop"] != r["crop"]]
        framed = None if whole else whole_frame(box, page, k, H, segs, others)
        if framed:
            whole = framed
        if whole:
            # Sibling panels inside the same image are this figure, not neighbours.
            others = [o for o in others if not (o[0] >= whole[0] - 5 and o[2] <= whole[2] + 5
                                               and o[1] >= whole[1] - 5 and o[3] <= whole[3] + 5)]
        cols = table_columns(r["sha"], r["crop"])
        piece_of_bigger = whole and (whole[2] - whole[0]) * (whole[3] - whole[1]) >= 2 * r["w"] * r["h"]
        if cols >= 2 and not piece_of_bigger:
            fragments.append({"paperSha256": r["sha"], "cropName": r["crop"], "w": r["w"], "h": r["h"],
                              "why": f"cell of a {cols}-column table"})
            continue
        nb, taken = grow(whole or box, segs, others, *image.size)
        if whole:
            taken = [("whole image", ("FRAME " if framed else "") + f"{box[2] - box[0]}x{box[3] - box[1]} -> {whole[2] - whole[0]}x{whole[3] - whole[1]}")] + taken
        if taken and taken[0][0] == "fragment":
            fragments.append({"paperSha256": r["sha"], "cropName": r["crop"], "w": r["w"], "h": r["h"],
                              "why": f"sign row {taken[0][1]!r} of a variation table"})
            continue
        if not taken:
            continue
        assert nb[0] <= box[0] and nb[1] <= box[1] and nb[2] >= box[2] and nb[3] >= box[3], "must contain the old box"
        grown.append({"paperSha256": r["sha"], "cropName": r["crop"], "paper": paths[r["sha"]], "page": r["page"],
                      "old": list(box), "new": list(nb), "took": taken, "questions": r["questions"], "ord": r["ord"],
                      "whole": list(whole) if whole else None})
        if SHEETS:
            SHEET_DIR.mkdir(parents=True, exist_ok=True)
            old = Image.open(f).convert("RGB")
            new = image.crop(nb)
            sheet = Image.new("RGB", (old.width + new.width + 40, max(old.height, new.height) + 40), "white")
            sheet.paste(old, (0, 40))
            sheet.paste(new, (old.width + 40, 40))
            ImageDraw.Draw(sheet).text((5, 5), f"{paths[r['sha']]} p{r['page']} {r['crop']}  BEFORE | AFTER  took {taken}", fill="black")
            sheet.save(SHEET_DIR / f"{len(grown):03d}_{r['crop']}.png")
        writes.append((f, r, image.crop(nb)))

    # Two panels that became the same whole image, shown to the same questions,
    # are one figure: keep the first in reading order, hold the other back.
    same = {}
    for g in sorted(grown, key=lambda g: g["ord"]):
        k2 = (g["paperSha256"], g["page"], tuple(g["whole"] or g["new"]), tuple(g["questions"]))
        if k2 in same:
            fragments.append({"paperSha256": g["paperSha256"], "cropName": g["cropName"], "w": g["old"][2] - g["old"][0],
                              "h": g["old"][3] - g["old"][1], "why": f"same whole image as {same[k2]}"})
        else:
            same[k2] = g["cropName"]
    dup = {fr["cropName"] for fr in fragments if fr["why"].startswith("same whole image")}
    grown = [g for g in grown if g["cropName"] not in dup]
    if APPLY:
        for f, r, img in writes:
            if r["crop"] in dup:
                continue
            b = BACKUP / r["sha"] / f"{r['crop']}.jpg"
            b.parent.mkdir(parents=True, exist_ok=True)
            if not b.exists():
                shutil.copyfile(f, b)
            img.save(f, quality=92)

    print()
    print(f"  gated/review crops      {len(rows)}")
    print(f"  re-cut                  {len(grown)}  (whole image: {sum(1 for g in grown if g['took'][0][0] == 'whole image')})")
    print(f"  fragments (kept off)    {len(fragments)}")
    print(f"  skipped                 {len(skipped)}")
    for g in grown:
        print(f"    {g['paper']} p{g['page']} {g['cropName']}  +{[t if w != 'whole image' else 'WHOLE ' + t for w, t in g['took']]}")
    for fr in fragments:
        print(f"    FRAGMENT {paths[fr['paperSha256']]} {fr['cropName']} {fr['w']}x{fr['h']}  {fr['why']}")
    for name, why in skipped:
        print(f"    SKIPPED {name}: {why}")
    if APPLY:
        RECEIPT.write_text(json.dumps(grown, ensure_ascii=False, indent=1), encoding="utf-8")
        FRAGMENTS.write_text(json.dumps(fragments, ensure_ascii=False, indent=1), encoding="utf-8")
        print("\n  Written. Originals in corpus/crop-audit/backup-jpg/. Now re-run figure_candidates.py,")
        print("  figure_ownership.py, then npm run corpus:visuals -- --apply --confirm-db <db>.")
    else:
        print("\n  DRY RUN - nothing written. Re-run with --apply.")


if __name__ == "__main__":
    main()

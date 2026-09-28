# -*- coding: utf-8 -*-
"""Crops the figures Mathpix never cut out of the science exam papers.

    python scripts/corpus/exercise_figures.py --report              # counts only, writes nothing
    python scripts/corpus/exercise_figures.py --sheet 40 --seed 7   # a contact sheet to audit by eye
    python scripts/corpus/exercise_figures.py --apply               # crops + manifest

WHY THIS EXISTS. Figures reach a question through the C1/C2/C3 pipeline, and
that pipeline can only own what Mathpix cropped. Mathpix crops embedded
pictures; it does not crop a circuit, a cube or a hatched cylinder that the
paper DRAWS with vector strokes. Measured 2026-09-28: of the science questions
shown without their figure, 268 sit on papers whose other exercises have
crops — the paper was read, this exercise's drawing was simply never cut out.

WHAT COUNTS AS A FIGURE, read from the PDF's own drawing operators:

  an embedded image                         a photo, a scan of a graph
  a curve                                   circles, arcs, plotted functions
  a diagonal line                           cube edges, resistor arrows, vectors
  a filled shape with no text inside        a hatched cylinder, a shaded region

and explicitly NOT:

  horizontal/vertical rules inside a table  (pdfplumber's own table finder)
  a frame round running text                "Doc. 4" printed as a boxed paragraph:
                                            the text is already in the question
  fraction bars, underlines, page rules     axis-aligned and short, or page-wide

Seeds are clustered, then grown along the straight rules that touch them (a
circuit's wires, a graph's axes), never along a table's rules and never along a
page-wide one. A cluster holding more than a paragraph's worth of words is a
text frame and is dropped.

WHERE. Only inside an exercise's own span (C1, `positioned-structure.json`),
so every crop has exactly one exercise and ownership is geometric, not a guess.
A figure that STARTS inside the span and runs past its end is kept whole.

Exercises that already own a crop through C3 are skipped: this fills gaps, it
never duplicates. Arabic editions of science papers are never read.

Output: corpus/exercise-figures/<sha12>/<page>-<n>.png and
corpus/exercise-figures/manifest.json. Nothing touches the database; the
registrar is register-exercise-figures.ts.
"""

import argparse
import hashlib
import json
import os
import random
import re
import sys
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
OUT = CORPUS / "exercise-figures"
POSITIONS = CORPUS / ".mapping" / "positioned-structure.json"
OWNERSHIP = CORPUS / ".mapping" / "figure-ownership.json"

SCIENCE = re.compile(r"(phy|chim|chem|bio|svt|sv_|math|riyad)", re.I)
GEOGRAPHY = re.compile(r"(geo|greo)", re.I)
ARABIC_EDITION = re.compile(r"(_ar\b|_ar[._]|arab|_dr\.pdf|_ar\.pdf)", re.I)
OWNING_LEVELS = {"EXERCISE", "QUESTION", "SUBQUESTION", "EXERCISE_CONTEXT", "EXERCISE_SHARED"}

DPI = 150
GAP = 18            # points between marks of one drawing
MIN_W, MIN_H = 35, 25
MAX_RULE = 300      # a straight rule longer than this is layout, not a drawing
TEXT_FRAME_WORDS = 25
PAD = 8


def f(v):
    return float(v)


def box(o):
    return [f(o["x0"]), f(o["top"]), f(o["x1"]), f(o["bottom"])]


def overlaps(a, b, slack=0.0):
    return a[0] - slack < b[2] and b[0] - slack < a[2] and a[1] - slack < b[3] and b[1] - slack < a[3]


def inside(a, b, slack=1.0):
    return a[0] >= b[0] - slack and a[1] >= b[1] - slack and a[2] <= b[2] + slack and a[3] <= b[3] + slack


def union(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def page_text_boxes(page):
    return [box(w) for w in page.extract_words(keep_blank_chars=False)]


def figure_boxes(page, y0, y1):
    """Bounding boxes of the drawings that start between y0 and y1 on this page."""
    starts = lambda o: y0 - 2 <= f(o["top"]) <= y1  # noqa: E731 — starts in the span, may run past it
    try:
        # A real table: two rows and two columns at least, and not tiny. The
        # finder also reports a circuit's battery or capacitor symbol as a
        # one-cell "table", and excluding those broke the circuit apart.
        tables = [
            list(t.bbox)
            for t in page.find_tables()
            if len(t.rows) >= 2
            and max(len(r.cells) for r in t.rows) >= 2
            and f(t.bbox[2]) - f(t.bbox[0]) > 60
            and f(t.bbox[3]) - f(t.bbox[1]) > 25
        ]
    except Exception:  # noqa: BLE001 — a malformed page must not stop the run
        tables = []
    in_table = lambda b: any(inside(b, [f(v) for v in t], 2) for t in tables)  # noqa: E731
    words = page_text_boxes(page)
    has_text = lambda b: any(inside(w, b, 1) for w in words)  # noqa: E731

    seeds = []
    for o in page.images:
        b = box(o)
        if starts(o) and b[2] - b[0] > 25 and b[3] - b[1] > 25:
            seeds.append(b)
    for o in page.curves:
        b = box(o)
        if not starts(o) or in_table(b):
            continue
        # A rectangle drawn as a path is a frame, not a curve.
        pts = o.get("pts") or []
        if len(pts) in (4, 5) and len({round(p[0]) for p in pts}) <= 2 and len({round(p[1]) for p in pts}) <= 2:
            continue
        seeds.append(b)
    for o in page.lines:
        pts = o.get("pts") or [(o["x0"], o["top"]), (o["x1"], o["bottom"])]
        (xa, ya), (xb, yb) = pts[0], pts[-1]
        if starts(o) and abs(f(xb) - f(xa)) > 2 and abs(f(yb) - f(ya)) > 2:
            seeds.append(box(o))
    for o in page.rects:
        b = box(o)
        if (
            starts(o)
            and o.get("fill")
            and b[2] - b[0] > 12 and b[3] - b[1] > 12
            and not in_table(b)
            and not has_text(b)
        ):
            seeds.append(b)

    # Cluster the seeds.
    clusters = [list(b) for b in seeds]
    changed = True
    while changed:
        changed = False
        merged = []
        for b in clusters:
            for m in merged:
                if overlaps(b, m, GAP):
                    m[:] = union(m, b)
                    changed = True
                    break
            else:
                merged.append(list(b))
        clusters = merged

    rules = [
        box(o)
        for o in page.lines + page.rects
        if not (f(o["bottom"]) < y0 - 40 or f(o["top"]) > y1 + 200)
    ]
    rules = [r for r in rules if max(r[2] - r[0], r[3] - r[1]) <= MAX_RULE and not in_table(r)]

    # Running text: a printed line of four or more words. A drawing's labels
    # are single words; a question's sentences are these.
    #
    # A row is split wherever words are a column apart, so the text column
    # beside a figure and the figure's own labels on the same row are two
    # segments, not one line running through the drawing. And a segment is
    # running text only if it holds real words and is wide: "O – C – CH3" is
    # five tokens and a label.
    rows = {}
    for w in page.extract_words():
        rows.setdefault(round(f(w["top"]) / 3), []).append(w)
    running = []
    segments = []
    for ws in rows.values():
        ws.sort(key=lambda w: f(w["x0"]))
        segment = [ws[0]]
        for w in ws[1:] + [None]:
            if w is not None and f(w["x0"]) - f(segment[-1]["x1"]) <= 12:
                segment.append(w)
                continue
            b = [min(f(x["x0"]) for x in segment), min(f(x["top"]) for x in segment),
                 max(f(x["x1"]) for x in segment), max(f(x["bottom"]) for x in segment)]
            real = sum(1 for x in segment if re.search(r"[A-Za-zÀ-ÿء-ي]{3,}", x["text"]))
            if real >= 3 and b[2] - b[0] > 120:
                running.append(b)
            # A cut sentence has a real word in it; "h = 80 m" and "A" are labels.
            if any(re.search(r"[A-Za-zÀ-ÿء-ي]{4,}", x["text"]) for x in segment):
                segments.append(b)
            if w is not None:
                segment = [w]

    out = []
    for m in clusters:
        if m[2] - m[0] < MIN_W or m[3] - m[1] < MIN_H:
            continue
        core = list(m)
        for _ in range(4):
            grown = False
            for r in rules:
                if overlaps(r, m, 4) and not inside(r, m):
                    m[:] = union(m, r)
                    grown = True
            if not grown:
                break
        # Judged on the drawing alone, before labels are added: a cluster
        # holding a paragraph is a framed text block, not a figure.
        text_words = [w for w in page.extract_words() if inside(box(w), m, 1) and re.search(r"[A-Za-zÀ-ÿء-ي]{3,}", w["text"])]
        if len(text_words) > TEXT_FRAME_WORDS:
            continue
        # Labels: very short words against the drawing ("R", "Doc.4", "A",
        # axis ticks). Kept tight so a neighbouring text column is not pulled in.
        for w in words:
            if overlaps(w, m, 6) and (w[2] - w[0]) < 40:
                m[:] = union(m, w)
        # Trim running text the growth pulled in, back to the drawing's core:
        # a sentence above or below cuts the box vertically, one beside it
        # (a text column next to a right-hand figure) cuts it sideways.
        # Also any text the crop's edge would slice through: a label lies wholly
        # inside the box (it was added whole above), so a segment crossing the
        # edge is part of a neighbouring sentence.
        crossing = [t for t in segments if overlaps(t, m) and not inside(t, m, 1)]
        for t in running + crossing:
            if not overlaps(t, m) or inside(t, core, 2):
                continue
            if t[3] <= core[1] + 2:
                m[1] = max(m[1], t[3] + 1)
            elif t[1] >= core[3] - 2:
                m[3] = min(m[3], t[1] - 1)
            elif t[2] <= core[0] + 2:
                m[0] = max(m[0], t[2] + 1)
            elif t[0] >= core[2] - 2:
                m[2] = min(m[2], t[0] - 1)
        if m[2] - m[0] < MIN_W or m[3] - m[1] < MIN_H:
            continue
        # The white margin, narrowed on any side where text sits closer than
        # PAD: a full margin reached half into the next sentence.
        outside = [w for w in words if not inside(w, m, 1)]
        def room(side):
            gaps = []
            for w in outside:
                if side in (1, 3) and not (w[0] < m[2] and m[0] < w[2]):
                    continue
                if side in (0, 2) and not (w[1] < m[3] and m[1] < w[3]):
                    continue
                gap = {0: m[0] - w[2], 1: m[1] - w[3], 2: w[0] - m[2], 3: w[1] - m[3]}[side]
                if gap >= 0:
                    gaps.append(gap)
            return max(0.0, min([PAD] + [g - 1 for g in gaps]))
        m = [m[0] - room(0), m[1] - room(1), m[2] + room(2), m[3] + room(3)]
        out.append(m)

    # Drop a box wholly inside another.
    return [b for b in out if not any(b is not o and inside(b, o) for o in out)]


def owned_exercises():
    """(pdf sha256, container ordinal) pairs that already own a C3 crop.

    Ordinal, not exercise index: a choice paper numbers its exercises
    1,2,3,1,2,3, so the index does not identify one. The ordinal is the
    exercise's position in the paper, which is also how load-exams keys it.
    """
    if not OWNERSHIP.exists():
        return set()
    positions = json.loads(POSITIONS.read_text("utf-8"))
    ordinal = {(p["sha256"][:12], c["ordinal"]): (p["sha256"], c["ordinal"]) for p in positions for c in p["containers"]}
    owned = set()
    for o in json.loads(OWNERSHIP.read_text("utf-8"))["occurrences"]:
        if o["ownershipLevel"] not in OWNING_LEVELS:
            continue
        for cid in o.get("ownerContainerIds") or []:
            sha12, n = cid.split("#")
            if (sha12, int(n)) in ordinal:
                owned.add(ordinal[(sha12, int(n))])
    return owned


HEADING_LINE = re.compile(
    r"^(?:(?:premier|première|deuxième|second|seconde|troisième|quatrième|cinquième|sixième)\s+exercice"
    r"|(?:first|second|third|fourth|fifth|sixth)\s+exercise"
    r"|(?:exercice|exercise|problème|problem)\s*(?:n°\s*)?(?:[ivx]+|\d+)\b"
    r"|(?:i|ii|iii|iv|v|vi|vii)\s*[-–.]\s*\(\s*\d)",
    re.I,
)


def heading_containers(pdf_path, n_exercises, paper_pages):
    """Exercise spans from the paper's printed headings, for a paper C1 never positioned.

    Only when the headings found are exactly as many as the exercises the
    extractor recorded: then heading k starts exercise k, and ordinals line up
    with how load-exams keyed the questions. Any other count returns nothing,
    because a crop given to the wrong exercise is worse than no crop.
    """
    with pdfplumber.open(str(pdf_path)) as pdf:
        pages = pdf.pages[: paper_pages or len(pdf.pages)]
        starts = []
        for n, page in enumerate(pages, start=1):
            rows = {}
            for w in page.extract_words():
                rows.setdefault(round(f(w["top"]) / 3), []).append(w)
            for ws in sorted(rows.values(), key=lambda ws: f(ws[0]["top"])):
                ws.sort(key=lambda w: f(w["x0"]))
                line = " ".join(w["text"] for w in ws)
                if HEADING_LINE.match(line.strip()):
                    starts.append((n, f(ws[0]["top"]), f(page.height)))
        if len(starts) != n_exercises or n_exercises == 0:
            return []
        containers = []
        for k, (page_no, top, height) in enumerate(starts):
            end_page, end_top = (starts[k + 1][0], starts[k + 1][1]) if k + 1 < len(starts) else (len(pages), None)
            spans = []
            for p in range(page_no, end_page + 1):
                y0 = top if p == page_no else 0.0
                y1 = end_top if (p == end_page and end_top is not None) else f(pages[p - 1].height)
                if p == end_page and end_top is not None and p != page_no and end_top <= 5:
                    continue
                spans.append({"page": p, "yStart": y0, "yEnd": y1, "pageHeight": f(pages[p - 1].height)})
            containers.append({"ordinal": k + 1, "index": k + 1, "spans": spans, "startsInScheme": False})
        return containers


def plan():
    positions = json.loads(POSITIONS.read_text("utf-8"))
    owned = owned_exercises()
    jobs = []
    for p in positions:
        name = os.path.basename(p["paper"])
        # Geography is taught in Arabic, so its papers ARE the Arabic edition;
        # the Arabic-edition rule applies to the sciences only.
        if GEOGRAPHY.search(name):
            pass
        elif not SCIENCE.search(name) or ARABIC_EDITION.search(name):
            continue
        pdf = CORPUS / "exams" / p["paper"]
        if not pdf.exists():
            continue
        for c in p["containers"]:
            if (p["sha256"], c["ordinal"]) in owned or c.get("startsInScheme"):
                continue
            jobs.append((p, c, pdf))

    # Science papers Mathpix never read have no C1 positions: their exercises
    # are found from the printed headings instead (see heading_containers).
    positioned = {p["sha256"] for p in positions}
    seen = set()
    for e in json.loads((CORPUS / "exams.json").read_text("utf-8")):
        path = e["path"].replace("\\", "/")
        name = os.path.basename(path)
        if e["sha256"] in positioned or e["sha256"] in seen:
            continue
        if not SCIENCE.search(name) or ARABIC_EDITION.search(name) or GEOGRAPHY.search(name):
            continue
        pdf = CORPUS / "exams" / path
        if not pdf.exists():
            continue
        seen.add(e["sha256"])
        try:
            containers = heading_containers(pdf, len(e["exercises"]), e.get("paperPages"))
        except Exception:  # noqa: BLE001 — an unreadable paper is skipped, not fatal
            containers = []
        HEADING_PAPERS[e["sha256"]] = bool(containers)
        p = {"paper": path, "sha256": e["sha256"]}
        for c in containers:
            jobs.append((p, c, pdf))
    return jobs


HEADING_PAPERS = {}


def detect(p, c, pdf_path, plumber_cache):
    if pdf_path not in plumber_cache:
        plumber_cache.clear()
        plumber_cache[pdf_path] = pdfplumber.open(str(pdf_path))
    pdf = plumber_cache[pdf_path]
    found = []
    for s in c["spans"]:
        if s["page"] > len(pdf.pages):
            continue
        page = pdf.pages[s["page"] - 1]
        k = f(page.height) / s["pageHeight"]
        for b in figure_boxes(page, s["yStart"] * k, s["yEnd"] * k):
            found.append({"page": s["page"], "box": [round(v, 1) for v in b], "pageSize": [f(page.width), f(page.height)]})
    return found


def crop(pdf_path, page_no, b, docs):
    if pdf_path not in docs:
        docs.clear()
        docs[pdf_path] = pdfium.PdfDocument(str(pdf_path))
    scale = DPI / 72
    image = docs[pdf_path][page_no - 1].render(scale=scale).to_pil()
    x0, y0, x1, y1 = b  # already carries its margin (figure_boxes)
    return image.crop((max(0, int(x0 * scale)), max(0, int(y0 * scale)), min(image.width, int(x1 * scale)), min(image.height, int(y1 * scale))))


def blank(image) -> bool:
    """White shapes and invisible paths render as nothing: a crop with under 1% ink."""
    grey = image.convert("L")
    dark = sum(grey.histogram()[:200])
    return dark < 0.01 * grey.width * grey.height


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--sheet", type=int, default=0, help="contact sheet of N random exercises with a detection")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--paper", default=None)
    ap.add_argument("--match", default=None, help="only papers whose path matches this regex")
    ap.add_argument("--only-headings", action="store_true", help="only papers positioned from their headings")
    args = ap.parse_args()

    jobs = plan()
    if args.paper:
        jobs = [j for j in jobs if j[0]["paper"] == args.paper]
    if args.only_headings:
        jobs = [j for j in jobs if j[0]["sha256"] in HEADING_PAPERS]
    if args.match:
        jobs = [j for j in jobs if re.search(args.match, j[0]["paper"], re.I)]
    print(f"{len(jobs)} exercises with no owned crop")
    if HEADING_PAPERS:
        ok = sum(1 for v in HEADING_PAPERS.values() if v)
        print(f"  papers without C1 positions: {len(HEADING_PAPERS)}, exercises found by heading on {ok}")

    cache, docs = {}, {}
    results = []
    for n, (p, c, pdf) in enumerate(jobs):
        try:
            found = detect(p, c, pdf, cache)
        except Exception as e:  # noqa: BLE001
            print(f"  skipped {p['paper']} ex {c['index']}: {e}", file=sys.stderr)
            continue
        if found:
            results.append((p, c, pdf, found))
        if (n + 1) % 200 == 0:
            print(f"  {n + 1}/{len(jobs)} exercises, {len(results)} with a figure", flush=True)
    figures = sum(len(r[3]) for r in results)
    print(f"{len(results)} exercises have a drawn figure ({figures} figures)")

    if args.sheet:
        from PIL import Image, ImageDraw

        random.seed(args.seed)
        pick = random.sample(results, min(args.sheet, len(results)))
        sheet_dir = OUT / "audit" / f"seed-{args.seed}"
        sheet_dir.mkdir(parents=True, exist_ok=True)
        tiles = []
        for i, (p, c, pdf, found) in enumerate(pick):
            for j, fig in enumerate(found):
                im = crop(pdf, fig["page"], fig["box"], docs)
                if blank(im):
                    continue
                im.thumbnail((380, 300))
                tiles.append((f"#{i}.{j} {p['paper']} ex{c['index']}", im))
        per = 12
        for s in range(0, len(tiles), per):
            chunk = tiles[s : s + per]
            sheet = Image.new("RGB", (4 * 400, 3 * 330), "white")
            d = ImageDraw.Draw(sheet)
            for t, (label, im) in enumerate(chunk):
                x, y = (t % 4) * 400, (t // 4) * 330
                d.text((x + 4, y + 2), label[:60], fill="red")
                sheet.paste(im, (x + 10, y + 20))
            sheet.save(sheet_dir / f"sheet-{s // per:02d}.png")
        print(f"audit sheets in {sheet_dir}")

    if args.apply:
        manifest = []
        for p, c, pdf, found in results:
            sha12 = p["sha256"][:12]
            for j, fig in enumerate(found):
                im = crop(pdf, fig["page"], fig["box"], docs)
                if blank(im):
                    continue
                rel = Path(sha12) / f"o{c['ordinal']}-p{fig['page']}-{j + 1}.png"
                dest = OUT / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                im.save(dest)
                manifest.append({
                    "paper": p["paper"],
                    "pdfSha256": p["sha256"],
                    "exerciseIndex": c["index"],
                    "ordinal": c["ordinal"],
                    "page": fig["page"],
                    "box": fig["box"],
                    "file": str(rel).replace("\\", "/"),
                    "contentSha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
                })
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), "utf-8")
        print(f"{len(manifest)} crops written; manifest at {OUT / 'manifest.json'}")


if __name__ == "__main__":
    main()

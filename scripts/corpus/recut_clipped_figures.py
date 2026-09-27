"""
Re-cuts a figure crop whose box was drawn too tight and clipped its own labels.

    python scripts/corpus/recut_clipped_figures.py              # report only
    python scripts/corpus/recut_clipped_figures.py --apply      # rewrite the .jpg files

WHY. Mathpix draws the figure boxes and sometimes stops short of the caption.
lh/2013 1/bio_fr.pdf page 2 prints two synapse panels side by side; the left one
was cut 713x317 against the right one's 718x406, and the 89 missing pixels were
its two labels. A student read "synaptique" with the word above it gone and
"Vesicule de" trailing into nothing.

THE NEW BOX IS DERIVED, NOT GUESSED, and that is the whole point. A first attempt
padded every side by a flat 45px, which restored the labels and pulled the
neighbouring panel into frame — a fixed margin cannot know how much room a crop
has. So:

  - VERTICALLY, the box grows to its sibling's row. Panels printed side by side
    are one figure cut into pieces; the tall one shows how tall the row is, so
    the short one is extended to match it. Nothing else decides the height.

  - HORIZONTALLY, the box grows by at most half the gap to the nearest crop on
    that page. Half a gap cannot reach a neighbour, whatever the gap is, and on
    a crowded page it contributes nothing rather than doing damage.

A SIBLING IS a crop on the same page whose top is within 60px and whose width is
within 15% — that is what "another panel in this row" looks like. A crop more
than 20% shorter than such a sibling is the one treated as clipped. Measured over
the corpus: 299 crops sit in a panel row and 24 of them are clipped.

THE NEW BOX ALWAYS CONTAINS THE OLD ONE. `y0` is a min, `y1` is a max, and the
horizontal padding only ever moves outward, so this can add content and can never
remove any. That is what makes it safe to run over crops already being served: the
worst case is a figure with more of its own page around it.

WHAT IT DOES NOT FIX. Some clipped crops are not figures at all — one is a plain
horizontal rule, and growing it produces a larger picture of a rule. Re-cutting
does not make a bad crop good; it only stops a good one being cut in half.

PROVENANCE. This rewrites the .jpg in place and leaves `visual_occurrences.bbox_*`
describing the old box. The bytes are content-hashed, so `npm run corpus:visuals
-- --apply` re-uploads the new image and repoints the occurrence at it; the stored
bbox stays as the record of what the detector originally proposed. Run the backfill
afterwards or the database keeps serving the old picture.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pypdfium2 as pdfium

sys.stdout.reconfigure(encoding="utf-8")

APPLY = "--apply" in sys.argv
ROOT = Path.cwd()
EXAMS = ROOT / "corpus/exams.json"

#: A sibling sits in the same row: its top within this many pixels...
SIBLING_ROW_PX = 60
#: ...and its width within this fraction of the wider of the two.
SIBLING_WIDTH_TOLERANCE = 0.15
#: Shorter than its sibling by more than this is "clipped".
CLIPPED_RATIO = 1.2
#: Never add more horizontal padding than this, even on an empty page.
MAX_SIDE_PAD = 45

QUERY = """
with pairs as (
  select a.id, a.crop_name, a.paper_sha256, a.page,
         a.bbox_x ax, a.bbox_y ay, a.bbox_w aw, a.bbox_h ah,
         b.bbox_y by_, b.bbox_h bh, a.page_width pw,
         row_number() over (partition by a.id order by b.bbox_h desc) rn
  from visual_occurrences a
  join visual_occurrences b
    on b.paper_sha256 = a.paper_sha256 and b.page = a.page and b.id <> a.id
   and abs(b.bbox_y - a.bbox_y) < {row}
   and abs(b.bbox_w - a.bbox_w) < greatest(a.bbox_w, b.bbox_w) * {tol}
  where b.bbox_h > a.bbox_h * {ratio})
select json_agg(row_to_json(t)) from (
  select p.*, (
    select coalesce(min(case when o.bbox_x >= p.ax + p.aw then o.bbox_x - (p.ax + p.aw)
                             when o.bbox_x + o.bbox_w <= p.ax then p.ax - (o.bbox_x + o.bbox_w) end), 9999)
      from visual_occurrences o
     where o.paper_sha256 = p.paper_sha256 and o.page = p.page and o.id <> p.id) as gap_x
  from pairs p where p.rn = 1) t;
""".format(row=SIBLING_ROW_PX, tol=SIBLING_WIDTH_TOLERANCE, ratio=CLIPPED_RATIO)


def clipped_crops():
    out = subprocess.run(
        ["docker", "exec", "bac2-db", "psql", "-U", "bac2", "-d", "bac2", "-t", "-A", "-c", QUERY],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.strip()
    return json.loads(out) if out and out != "" else []


def main():
    rows = clipped_crops()
    paper_path = {r["sha256"]: r["path"] for r in json.loads(EXAMS.read_text(encoding="utf-8"))}

    rendered, done, skipped = {}, [], []
    for r in rows:
        rel = paper_path.get(r["paper_sha256"])
        pdf = ROOT / "corpus/exams" / rel if rel else None
        crop = ROOT / "corpus/text" / r["paper_sha256"] / "figures" / f"{r['crop_name']}.jpg"
        if not pdf or not pdf.exists() or not crop.exists():
            skipped.append((r["crop_name"], "no pdf" if not (pdf and pdf.exists()) else "no crop file"))
            continue

        key = (str(pdf), r["page"])
        if key not in rendered:
            page = pdfium.PdfDocument(str(pdf))[r["page"] - 1]
            rendered[key] = page.render(scale=r["pw"] / page.get_width()).to_pil()
        image = rendered[key]

        # Vertical: the sibling's row. Horizontal: at most half the gap.
        y0 = max(0, min(r["ay"], r["by_"]))
        y1 = min(image.size[1], max(r["ay"] + r["ah"], r["by_"] + r["bh"]))
        pad = max(0, min(MAX_SIDE_PAD, r["gap_x"] // 2))
        x0 = max(0, r["ax"] - pad)
        x1 = min(image.size[0], r["ax"] + r["aw"] + pad)

        assert x0 <= r["ax"] and y0 <= r["ay"], "the new box must contain the old one"
        assert x1 >= r["ax"] + r["aw"] and y1 >= r["ay"] + r["ah"], "the new box must contain the old one"

        if APPLY:
            image.crop((x0, y0, x1, y1)).save(crop, quality=92)
        done.append((r["crop_name"], (r["aw"], r["ah"]), (x1 - x0, y1 - y0)))

    print()
    print(f"  clipped crops found   {len(rows)}")
    print(f"  re-cut                {len(done)}")
    print(f"  skipped               {len(skipped)}")
    print()
    for name, before, after in done:
        print(f"    {name}  {before[0]}x{before[1]} -> {after[0]}x{after[1]}")
    for name, why in skipped:
        print(f"    SKIPPED {name}: {why}")
    print()
    if APPLY:
        print("  Written. Now run:  npm run corpus:visuals -- --apply --confirm-db <db>")
        print("  Until that runs the database still serves the old image.")
    else:
        print("  DRY RUN - no file was written. Re-run with --apply.")
    print()


if __name__ == "__main__":
    main()

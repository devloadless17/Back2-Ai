"""
Cuts the printed band of an exercise out of its own PDF, as a picture.

    python scripts/corpus/render_exercise_bands.py --manifest <placed.json> --out <dir>

WHY THIS EXISTS. A few hundred science rows lost their formulas to the PDF text
layer: `2f(x) x lnx= +` is what the reader returns for `f(x) = x² + ln x`. The
repair pipelines refused them — the Mathpix rebuild had no matching record, and
the crop pipeline found no figure to cut, because there is no figure, only
mathematics set as text. Nothing in the corpus can reconstruct those glyphs.

So we stop trying to rebuild the text and show the student the paper instead.
C1 already recorded, for every exercise it positioned, which page it starts on
and the y range it occupies. That is a band on a page, and a band on a page can
be rendered. The student reads the formula off the exam as printed.

THIS IS NOT A FIGURE CROP AND MUST NOT ENTER THE C2/C3 CHAIN. `backfill-visuals`
checks every crop's bytes against the hash C2 recorded and silently skips what
disagrees; a band has no C2 record at all. It is loaded separately, under its
own evidence run, at tier `human` — the one tier apply and rollback never touch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import pypdfium2 as pdfium
from PIL import Image

ROOTS = ("corpus/exams", "corpus", "corpus/papers")

# The band is the exercise's own y range, but a printed exercise leans on the
# line above it — a rubric, a units note, the figure caption it refers to. A
# little air above and below costs nothing and rescues those.
PAD_FRACTION = 0.02
# Enough to read a subscript on a phone without making the file heavy.
SCALE = 2.0
# Two bands from the same page are one reading; joining them beats handing the
# student two pictures of the same sheet.
GAP_PX = 12


def find_pdf(rel: str) -> str | None:
    rel = rel.replace(chr(92), "/")
    for root in ROOTS:
        candidate = os.path.join(root, rel)
        if os.path.exists(candidate):
            return candidate
    return None


def band_of(page, y_start: float, y_end: float, page_height: float) -> Image.Image:
    """Render the slice of `page` between two y values given in C1's pixel space."""
    # C1 measured in the renderer's pixels, not PDF points, and records the page
    # height it measured against. Working in fractions makes the two spaces meet.
    top = max(0.0, y_start / page_height - PAD_FRACTION)
    bottom = min(1.0, y_end / page_height + PAD_FRACTION)
    if bottom <= top:
        raise ValueError(f"empty band {y_start}..{y_end} of {page_height}")
    bitmap = page.render(scale=SCALE)
    image = bitmap.to_pil()
    height = image.height
    return image.crop((0, int(top * height), image.width, int(bottom * height)))


def stack(images: list[Image.Image]) -> Image.Image:
    """Join bands top to bottom on one canvas, centred, on white."""
    if len(images) == 1:
        return images[0]
    width = max(i.width for i in images)
    height = sum(i.height for i in images) + GAP_PX * (len(images) - 1)
    canvas = Image.new("RGB", (width, height), "white")
    y = 0
    for image in images:
        canvas.paste(image, ((width - image.width) // 2, y))
        y += image.height + GAP_PX
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, help="rows placed on a paper and ordinal")
    ap.add_argument("--out", required=True, help="directory for the rendered bands")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    rows = json.load(open(args.manifest, encoding="utf-8"))
    if args.limit:
        rows = rows[: args.limit]
    os.makedirs(args.out, exist_ok=True)

    # One PDF serves many rows; opening it once per row is the slow way.
    opened: dict[str, pdfium.PdfDocument] = {}
    written, skipped = [], []
    for row in rows:
        path = find_pdf(row["path"])
        if not path:
            skipped.append((row["id"], "no pdf"))
            continue
        try:
            doc = opened.get(path) or opened.setdefault(path, pdfium.PdfDocument(path))
            # Bands from one page are rendered together, in page order.
            by_page: dict[int, list[dict]] = {}
            for span in row["spans"]:
                by_page.setdefault(int(span["page"]), []).append(span)
            images = []
            for page_no in sorted(by_page):
                if not 1 <= page_no <= len(doc):
                    raise ValueError(f"page {page_no} outside a {len(doc)}-page pdf")
                page = doc[page_no - 1]
                spans = by_page[page_no]
                images.append(
                    band_of(
                        page,
                        min(float(s["yStart"]) for s in spans),
                        max(float(s["yEnd"]) for s in spans),
                        float(spans[0]["pageHeight"]),
                    )
                )
            image = stack(images)
            if image.height < 40 or image.width < 40:
                raise ValueError(f"band too small to read: {image.width}x{image.height}")
            # Forward slashes even on Windows: this manifest is read by a Linux
            # container, where a backslash is part of the filename rather than a
            # separator, and every band would fail to open.
            out = os.path.join(args.out, f"{row['id']}.png").replace(chr(92), "/")
            image.save(out, "PNG", optimize=True)
            digest = hashlib.sha256(open(out, "rb").read()).hexdigest()
            written.append(
                {
                    # `score` comes from the wording matcher and `hits` from the
                    # text-layer locator; a manifest carries one or the other.
                    **{k: row[k] for k in ("id", "subject", "path", "sha", "ordinal", "score", "hits") if k in row},
                    "file": out,
                    "contentHash": digest,
                    "byteSize": os.path.getsize(out),
                    "page": sorted(by_page)[0],
                    "pages": sorted(by_page),
                    "width": image.width,
                    "height": image.height,
                }
            )
        except Exception as exc:  # a band that cannot be cut is reported, never guessed at
            skipped.append((row["id"], str(exc)))

    index = os.path.join(args.out, "bands.json")
    json.dump(written, open(index, "w", encoding="utf-8"), indent=1)
    print(f"rendered {len(written)}, skipped {len(skipped)} -> {index}")
    for qid, why in skipped[:10]:
        print(f"  skipped {qid}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""Reads the printed page number and running header off every page of a scanned book.

    python scripts/corpus/read_page_marks.py "corpus/crdp ebooks/LS/EN/biology_en.pdf" [...]

The CRDP scans have no text layer, and Mathpix drops page numbers from its
output, so nothing in corpus/text says which printed page a scan page is. This
renders the top and bottom strip of each page and runs a local OCR engine
(rapidocr, offline, free) over them. Every detection is kept with its box, so
the choice of "which number is the page number" is made later, in
audit_book_pages.py, and can be changed without re-reading 3,000 pages.

Output: corpus/page-audit/marks/<sha8>.json, one entry per scan page. A book
already read is skipped, keyed by the hash of the PDF, so the EN and FR copies
of a shared book are read once.
"""

import hashlib
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "corpus" / "page-audit" / "marks"

BOTTOM = 0.86  # strip starts at 86% of the page height
TOP = 0.09     # strip ends at 9%

_ocr = None


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def read_pages(args):
    path, pages = args
    global _ocr
    import numpy as np
    import pypdfium2 as pdfium
    from PIL import ImageOps
    from rapidocr_onnxruntime import RapidOCR

    if _ocr is None:
        # One thread per worker: onnxruntime's default takes every core in every
        # worker, and twelve workers fighting over sixteen cores took 13 minutes
        # for a 139-page book. Small digits need resolution: at 1x render with
        # the resize capped, two-thirds of the page numbers were missed (87 of
        # 139 pages differed from the slow run). Rendering at 3x and letting the
        # detector keep that size reads them, in far less memory than the
        # default ~6x upscale, which ran out of memory with twelve workers.
        _ocr = RapidOCR(det_limit_type="max", det_limit_side_len=1800, use_cls=False,
                        intra_op_num_threads=1, inter_op_num_threads=1)
    doc = pdfium.PdfDocument(path)
    out = []
    for p in pages:
        img = doc[p - 1].render(scale=3.0).to_pil()
        w, h = img.size
        entry = {"page": p, "w": w, "h": h}
        for name, box, y0 in (("bottom", (0, int(h * BOTTOM), w, h), int(h * BOTTOM)),
                              ("top", (0, 0, w, int(h * TOP)), 0)):
            strip = img.crop(box)
            # Many books print the number in white on a coloured band, which the
            # colour read misses; an inverted greyscale copy reads it. Both are
            # kept, and the audit merges them.
            inverted = ImageOps.autocontrast(ImageOps.invert(strip.convert("L"))).convert("RGB")
            for suffix, im in (("", strip), ("_inv", inverted)):
                result, _ = _ocr(np.array(im))
                entry[name + suffix] = [
                    {"text": text, "conf": round(float(conf), 3),
                     "x0": round(min(pt[0] for pt in quad) / w, 4),
                     "x1": round(max(pt[0] for pt in quad) / w, 4),
                     "y0": round((min(pt[1] for pt in quad) + y0) / h, 4),
                     "y1": round((max(pt[1] for pt in quad) + y0) / h, 4)}
                    for quad, text, conf in (result or [])
                ]
        out.append(entry)
    return out


def main():
    global OUT
    if "--out" in sys.argv:
        i = sys.argv.index("--out")
        OUT = Path(sys.argv[i + 1])
        del sys.argv[i:i + 2]
    OUT.mkdir(parents=True, exist_ok=True)
    import pypdfium2 as pdfium

    for arg in sys.argv[1:]:
        path = Path(arg)
        digest = sha256(path)
        target = OUT / f"{digest[:8]}.json"
        if target.exists():
            print(f"skip {path} (already read as {target.name})")
            continue
        n = len(pdfium.PdfDocument(str(path)))
        chunks = [(str(path), list(range(i, min(i + 8, n + 1)))) for i in range(1, n + 1, 8)]
        pages = []
        with ProcessPoolExecutor(max_workers=8) as pool:
            for part in pool.map(read_pages, chunks):
                pages.extend(part)
        pages.sort(key=lambda e: e["page"])
        target.write_text(json.dumps({"file": path.name, "sha256": digest, "pages": pages},
                                     ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"read {path} -> {target.name} ({n} pages)")


if __name__ == "__main__":
    main()

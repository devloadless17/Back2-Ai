# -*- coding: utf-8 -*-
"""Draws the header and footer strips of chosen scan pages onto one image, each
labelled with its scan page, so the page numbers OCR could not read can be read
by eye and written to corpus/page-audit/manual/<sha8>.json.

    python scripts/corpus/page_mark_sheet.py <pdf> <out.png> 19 55 80 ...
    python scripts/corpus/page_mark_sheet.py <pdf> <out.png> --full 138

--full draws whole pages (small) instead of strips, for pages with no number
where the question is what the page is.
"""

import sys

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont


def main():
    pdf, out, *rest = sys.argv[1:]
    full = "--full" in rest
    scans = [int(x) for x in rest if x != "--full"]
    doc = pdfium.PdfDocument(pdf)
    try:
        font = ImageFont.truetype("arial.ttf", 26)
    except OSError:
        font = ImageFont.load_default()
    tiles = []
    for s in scans:
        img = doc[s - 1].render(scale=1.3 if not full else 0.55).to_pil()
        w, h = img.size
        if full:
            tile = img
        else:
            top = img.crop((0, 0, w, int(h * 0.075)))
            bottom = img.crop((0, int(h * 0.87), w, h))
            tile = Image.new("RGB", (w, top.size[1] + bottom.size[1] + 4), "black")
            tile.paste(top, (0, 0))
            tile.paste(bottom, (0, top.size[1] + 4))
        label = Image.new("RGB", (tile.size[0], 32), (255, 240, 0))
        ImageDraw.Draw(label).text((6, 2), f"scan {s}", fill="black", font=font)
        framed = Image.new("RGB", (tile.size[0], tile.size[1] + 32), "white")
        framed.paste(label, (0, 0))
        framed.paste(tile, (0, 32))
        tiles.append(framed)
    if full:
        cols = 4
        tw, th = max(t.size[0] for t in tiles), max(t.size[1] for t in tiles)
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (tw + 6), rows * (th + 6)), "grey")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * (tw + 6), (i // cols) * (th + 6)))
    else:
        cols = 2
        tw, th = max(t.size[0] for t in tiles), max(t.size[1] for t in tiles)
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (tw + 8), rows * (th + 8)), "grey")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * (tw + 8), (i // cols) * (th + 8)))
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()

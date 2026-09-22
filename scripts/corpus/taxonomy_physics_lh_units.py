# -*- coding: utf-8 -*-
"""Patches unit labels onto the LH/SE physics (English) taxonomy.

    python scripts/corpus/taxonomy_physics_lh_units.py

Run AFTER taxonomy.py has (re)built physics-lh-en__3f6585b4.json — this only
layers units on top of that output, it does not re-derive the chapter spans.

WHY THE AUTOMATIC BUILD MISSED THE UNITS. The book's contents page (page 8 of
the scan) is a single cropped image with no text layer at all — Mathpix
returned only the picture, nothing to parse. Same class of gap as the GS/LS
physics book, different cause (there it was OCR noise on a real text table;
here there is no text at all).

The four units and their chapter ranges are stated directly in the book's own
preface (corpus/text/physics-lh-en__3f6585b4/page-009.md): "a straight forward
presentation of four units: energy, radioactivity, universe, and petroleum.
Each unit consists of three chapters except the Universe Unit which is
explained in four chapters." Chapter titles and counts checked against that.
"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
PATH = ROOT / "corpus" / "taxonomy" / "physics-lh-en__3f6585b4.json"

UNITS = [
    ("Energy", range(1, 4)),
    ("Radioactivity", range(4, 7)),
    ("Universe", range(7, 11)),
    ("Petroleum", range(11, 14)),
]


def main() -> None:
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    unit_by_index = {i: name for name, idxs in UNITS for i in idxs}

    for c in doc["chapters"]:
        c["unit"] = unit_by_index.get(c["index"])

    doc["unitCount"] = len(UNITS)
    PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    for c in doc["chapters"]:
        print("  %2d  [%-13s] %s" % (c["index"], c["unit"], c["title"]))
    print("\n  %d chapters, %d units -> %s" % (len(doc["chapters"]), doc["unitCount"], PATH))


if __name__ == "__main__":
    main()

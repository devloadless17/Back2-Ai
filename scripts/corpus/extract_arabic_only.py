# -*- coding: utf-8 -*-
"""Extract only the Arabic-taught papers, into a file of their own.

    python scripts/corpus/extract_arabic_only.py
    -> corpus/exams-arabic.json

Same `read()` and the same two-tracks-one-paper handling as
`extract_exams.main()`, over the papers listed in corpus/exams-ocr/index.json
(Arabic-taught, History, translations, accommodation and science excluded).

Why a separate file. `load-exams.ts` retires every question of a paper it
read but did not see again, scoped to the papers in the file it is given. A
full `corpus/exams.json` would re-load every science paper too, with whatever
the extractor produces for them today. This file keeps the load to the papers
this change is about, and leaves corpus/exams.json to its owner.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_exams as ee  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "corpus" / "exams-arabic.json"


import re

# Three repairs that are always right in Arabic text, applied to everything this
# file writes, so a re-load cannot bring back what an earlier SQL patch fixed.
# A fix made only in the database lasted until the next load rewrote the row.
#
#   a vowel mark cannot follow a space: it belongs to the letter before it
#   ھ (Urdu heh) where Arabic ه belongs
#   a mark bracket printed mirrored: ")علامة ونصف(" -> "(علامة ونصف)"
_LOOSE_VOWEL = re.compile(r" +([ً-ْ])")
# "علامة" may be stretched with tatweel ("عـلامـات"), and only one bracket may
# be flipped (")علامة واحدة)"); both forms seen on production.
_MARK_WORD = r"عـ*لـ*اـ*م"
_MIRRORED_MARK = re.compile(rf"\)([^()\n]{{0,30}}{_MARK_WORD}[^()\n]{{0,30}})[()]")


def tidy(text):
    if not isinstance(text, str):
        return text
    text = _LOOSE_VOWEL.sub(r"\1", text).replace("ھ", "ه")
    return _MIRRORED_MARK.sub(r"(\1)", text)


def tidy_entry(entry: dict) -> dict:
    for key in ("passage",):
        entry[key] = tidy(entry.get(key))
    for e in entry["exercises"]:
        for key in ("title", "statement"):
            e[key] = tidy(e.get(key))
        for p in e["parts"]:
            for key in ("text", "answer"):
                if key in p:
                    p[key] = tidy(p[key])
    return entry


def main() -> None:
    index = json.loads((ROOT / "corpus" / "exams-ocr" / "index.json").read_text("utf-8"))
    files = sorted((ROOT / rel).resolve() for rel in index)

    seen, parsed, results = set(), {}, []
    for pdf in files:
        digest = ee.sha256_of(pdf)
        if digest in seen:
            first = parsed.get(digest)
            if first and "error" not in first:
                rel = pdf.relative_to(ee.EXAMS)
                results.append({**first, "path": str(rel), "file": pdf.name,
                                "track": rel.parts[0].upper() if rel.parts else first.get("track")})
            continue
        seen.add(digest)
        row = ee.read(pdf)
        if row:
            parsed[digest] = row
            results.append(row)

    good = [tidy_entry(r) for r in results if "error" not in r]
    OUT.write_text(json.dumps(good, ensure_ascii=False), encoding="utf-8")
    bad = [r for r in results if "error" in r]
    print(f"{len(results)} entries, {len(good)} extracted, {len(bad)} skipped -> {OUT.name}")
    print(f"  exercises {sum(len(r['exercises']) for r in good)}"
          f"  sub-questions {sum(len(e['parts']) for r in good for e in r['exercises'])}"
          f"  marks attached {sum(r['marksFound'] for r in good)}")
    for r in bad[:10]:
        print(f"  skipped {r['path']}: {r['error']}")


if __name__ == "__main__":
    main()

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

    good = [r for r in results if "error" not in r]
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

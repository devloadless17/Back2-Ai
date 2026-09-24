# -*- coding: utf-8 -*-
"""Lists the scan pages of an audited book that need a look by eye — no number
read, number far from its neighbours, duplicate numbers, pages next to a
missing number — and draws them with page_mark_sheet.py.

    python scripts/corpus/page_suspects.py biology_en <out.png>
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "corpus"))
from audit_book_pages import AUDIT, BOOKS, LS  # noqa: E402

name, out = sys.argv[1], sys.argv[2]
r = json.loads((AUDIT / "LS" / f"{name}.json").read_text(encoding="utf-8"))
manual_path = AUDIT / "manual" / f"{BOOKS[name][1]}.json"
manual = json.loads(manual_path.read_text(encoding="utf-8")) if manual_path.exists() else {}
pm = {p["scan"]: p for p in r["pageMap"]}
s = set(r["unreadScanPages"])
s |= {m["scanPage"] for m in r["misplaced"]}
s |= {x for d in r["duplicates"] for x in d["scanPages"]}
s |= {p["scan"] for p in r["pageMap"] if p["how"] == "ocr-isolated"}
for v in r["missingPrintedPages"]:
    for p in r["pageMap"]:
        if p["printed"] in (v - 1, v + 1):
            s |= {p["scan"] - 1, p["scan"], p["scan"] + 1}
s = sorted(x for x in s if 1 <= x <= r["scanPages"] and str(x) not in manual)
print(name, len(s), s)
if s:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "corpus" / "page_mark_sheet.py"),
                    str(LS / BOOKS[name][0][0]), out, *map(str, s)], check=True)

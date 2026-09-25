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


# load-exams skips a statement shorter than this (its "too short to be usable").
MIN_STATEMENT = 90


def reshape(entry: dict) -> dict:
    """Two structural repairs, for the Arabic-taught papers only.

    A WHOLE PAPER READ AS ONE EXERCISE. A civics paper prints its questions
    "١- … ٢- … ٣- … ٤-" with no exercise headings, so the extractor returns
    one exercise with the numbered questions as its parts — and question 1 in
    the title. Its parts are marked correctly (3 + 9 + 9 + 9 on gs/2008 1),
    which is exactly why it failed: load-exams refuses any exercise worth more
    than 20, and 25 civics exercises reached production with no barème at all.
    Each numbered question is its own exercise, so it is split into them.

    AN EXERCISE WITH NO PARTS can never be given its official answer, because
    answers attach to parts. The extractor already gives an essay subject one
    unlabelled part for exactly this reason; economics and sociology exercises
    get the same, holding the exercise's own text. The question a student sees
    is built from the title and statement, never the parts, so nothing is shown
    twice.
    """
    out, n = [], 0
    for e in entry["exercises"]:
        marked = [p["marks"] for p in e["parts"] if isinstance(p.get("marks"), (int, float))]
        if len(e["parts"]) >= 2 and sum(marked) > 20:
            first = (e.get("title") or "").strip()
            if first.count("(") > first.count(")"):
                first += ")"
            pieces = ([(first, ee.text_marks(first), None)] if len(first) >= 20 else []) + [
                (p["text"], p.get("marks"), p.get("answer")) for p in e["parts"]
            ]
            # Grouped until each exercise reaches load-exams' 80-character
            # floor. Civics questions are often one line — "حدّد طبيعة كلّ من
            # المستندين… (علامة ونصف)" is 70 — and split one per exercise, 126
            # real questions fell under it and were skipped. Neighbours share an
            # exercise instead; each stays its own part, with its own mark and
            # its own answer.
            groups, current = [], []
            for piece in pieces:
                current.append(piece)
                if len(" ".join(t for t, _, _ in current)) >= MIN_STATEMENT:
                    groups.append(current)
                    current = []
            if current:
                if groups:
                    groups[-1].extend(current)
                else:
                    groups.append(current)
            for group in groups:
                n += 1
                parts = []
                for text, marks, answer in group:
                    part = {"label": "", "text": text}
                    if isinstance(marks, (int, float)):
                        part["marks"] = marks
                    if answer:
                        part["answer"] = answer
                    parts.append(part)
                marks = sum(p["marks"] for p in parts if "marks" in p)
                out.append({**e, "index": n, "title": "",
                            "statement": "\n".join(t for t, _, _ in group),
                            "marks": marks, "parts": parts})
            continue
        n += 1
        e = {**e, "index": n}
        if not e["parts"] and e.get("statement"):
            e["parts"] = [{"label": "", "text": e["statement"]}]
        out.append(e)
    entry["exercises"] = out
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

    # Tidied again after the split: joining a title back to its parts can
    # produce a bracket the first pass never saw (")علامة واحدة)").
    good = [tidy_entry(reshape(tidy_entry(r))) for r in results if "error" not in r]
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

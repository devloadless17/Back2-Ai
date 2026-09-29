# -*- coding: utf-8 -*-
"""Split old geography papers into one question per numbered part.

    python scripts/corpus/split_geography.py          report only
    python scripts/corpus/split_geography.py --apply  rewrites corpus/exams-arabic.json

Run AFTER attach_answers.py. The 2004-2019 geography papers extract as one
exercise: question 1 in its heading, questions 2-7 as its parts. A student
then meets the whole paper as one 2,000-character question — 84 papers, one
question each. Each numbered part is its own question on the paper, with its
own mark, so each becomes its own exercise here.

After the answers, not in extract_arabic_only.reshape: attach_answers caches
its paid reply per paper and per the exact list of parts, so reshaping first
would change every list and pay again for answers already held. Here the parts
keep the answers they were given.

Only papers up to 2019, and only exercises with three or more parts numbered
1, 2, 3... that carry their own marks (or that are the whole paper): the
2021+ papers already come one exercise per question, and their "أ- / ب-"
sub-parts and multiple-choice items belong together. The documents stay on the paper (`passage`), which every question
shows. Neighbours shorter than load-exams' floor are grouped, as reshape does.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_exams as ee  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FILE = ROOT / "corpus" / "exams-arabic.json"
MIN_STATEMENT = 90  # as extract_arabic_only.MIN_STATEMENT
NUMBERED = re.compile(r"^\s*\d+\s*$")


def lead_of(e: dict, first_part: str) -> str:
    """Question 1: the heading plus the statement up to where part one starts."""
    statement = e.get("statement") or ""
    head = first_part.strip()[:30]
    cut = statement.find(head) if head else -1
    before = statement[:cut] if cut > 0 else ""
    return "\n".join(s for s in ((e.get("title") or "").strip(), before.strip()) if s)


def split(e: dict, whole_paper: bool = False) -> list | None:
    parts = e.get("parts") or []
    numbered = [p for p in parts if NUMBERED.match(p.get("label") or "")]
    # Each part carries its own mark, as a question of the paper does — or the
    # exercise is the whole paper, where the transcription put the marks on
    # lines of their own and no part kept one. An "اختر الإجابة الصحيحة" group
    # numbers its items 1-4 too, but they share one instruction and one mark,
    # and split they lose both.
    marked = [p for p in numbered if isinstance(p.get("marks"), (int, float))]
    if len(numbered) < 3 or (len(marked) < 3 and not whole_paper):
        return None
    total = sum(p["marks"] for p in parts if isinstance(p.get("marks"), (int, float)))
    lead = lead_of(e, parts[0].get("text") or "")
    pieces = []
    if len(lead) >= 20:
        rest = (e.get("marks") or 0) - total
        pieces.append({"label": "1", "text": lead, **({"marks": rest} if rest > 0 else {})})
    pieces += parts
    groups, current = [], []
    for piece in pieces:
        current.append(piece)
        if len(" ".join(p.get("text") or "" for p in current)) >= MIN_STATEMENT:
            groups.append(current)
            current = []
    if current:
        if groups:
            groups[-1].extend(current)
        else:
            groups.append(current)
    out = []
    for group in groups:
        marks = sum(p["marks"] for p in group if isinstance(p.get("marks"), (int, float)))
        out.append({**e, "title": "", "statement": "\n".join(p.get("text") or "" for p in group),
                    "marks": marks, "parts": group})
    return out


def main() -> None:
    apply = "--apply" in sys.argv
    papers = json.loads(FILE.read_text("utf-8"))
    before = after = touched = 0
    for p in papers:
        if ee.profile_for(p["path"]) != "geography":
            continue
        # 2021 on, the papers come one exercise per question already, with
        # labels that restart inside a question; they are left as they are.
        if int(re.search(r"(20\d\d)", p["path"]).group(1)) > 2019:
            continue
        out, changed = [], False
        whole = len(p["exercises"]) == 1
        for e in p["exercises"]:
            pieces = split(e, whole)
            before += 1
            if pieces:
                changed = True
                out.extend(pieces)
            else:
                out.append(e)
        if changed:
            touched += 1
            for i, e in enumerate(out, 1):
                e["index"] = i
            p["exercises"] = out
        after += len(p["exercises"])
    print(f"geography: {touched} papers split, exercises {before} -> {after}")
    if apply:
        FILE.write_text(json.dumps(papers, ensure_ascii=False, indent=1), "utf-8")
        print(f"written {FILE.name}")


if __name__ == "__main__":
    main()

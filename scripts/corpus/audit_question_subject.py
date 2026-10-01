"""
Finds questions filed under the wrong subject, by looking at the paper they came from.

    python scripts/corpus/audit_question_subject.py --questions <in.json> --out <report.json>

WHY THE PAPER AND NOT THE TEXT. Deciding a question's subject from its wording
means judging content, and the wording is exactly what is damaged in this
corpus. The paper it was printed in is not a judgement: an economics question
sits in `eco_fr.pdf` and nowhere else, and the filename is part of the archive's
own filing. So each question is located in the PDFs — by its letters, with the
spaces folded away, the same way the passages were recovered — and the paper
that holds it is asked what subject it is.

IT ONLY REPORTS. Re-filing a question moves it between chapters and tracks, and
a wrong move is worse than a wrong label, so nothing is written here.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import pickle
import re
import sys

import pypdfium2 as pdfium

LETTERS = re.compile(r"[^\W\d_]", re.UNICODE)
PROBE = 60

# What a paper's filename says it is.
#
# THE ARCHIVE NAMES ITS SUBJECTS IN TRANSLITERATED ARABIC, not in French or
# English. The economics paper is `ektesad_fr.pdf`, not `eco_fr.pdf`; philosophy
# is `falsafe`; civics is `tarbiya`. A first pass that looked only for the
# European words found 30 misfiled questions and missed the economics paper
# entirely — the transliterations are not an edge case here, they are the usual
# spelling, and they vary (`ektesad` and `esktesad` sit in the same folder).
#
# ORDER MATTERS. Every one of these files also ends `_fr` or `_en`, which names
# the EDITION, not the subject. The subject patterns are therefore tried first
# and the language ones last, so `ektesad_fr.pdf` is economics in French rather
# than French.
SUBJECT_OF_PAPER = [
    ("economics", re.compile(r"\beco|ekte?sad|esktesad|iktisad|iqtisad", re.I)),
    ("sociology", re.compile(r"socio|ijtima|ejtema|igtima", re.I)),
    ("philosophy", re.compile(r"falsafe|falsafa|philo", re.I)),
    ("history", re.compile(r"\bhist|tarikh|tarekh|ta2rikh", re.I)),
    ("geography", re.compile(r"\bgeo|joghra|jughra|geogra", re.I)),
    ("civics", re.compile(r"civic|tarbiya|tarbeya|wataniy|madaniy", re.I)),
    ("mathematics", re.compile(r"math", re.I)),
    ("physics", re.compile(r"\bphy|fiziya|fizya", re.I)),
    ("chemistry", re.compile(r"chem|chim|kimya", re.I)),
    ("biology", re.compile(r"\bbio|\bsv\b|sciences?.?de.?la.?vie|ulum.?hayat", re.I)),
    ("arabic", re.compile(r"arab|lugha|adab", re.I)),
    # `\b` IS THE WRONG BOUNDARY FOR THESE NAMES. Underscore is a word
    # character, so `_fr\b` does not match `fr_ehteyejet.pdf` and `\bfr\b` does
    # not match `SE_Fran_2021_1.pdf` either. Here the separators ARE underscores,
    # so the boundary has to be "not a letter": that catches `fr.pdf`,
    # `fr_ehteyejet.pdf` and `_Fr_` alike, and `fran` catches the rest.
    ("english", re.compile(r"(?:^|[^a-z])eng?(?:[^a-z]|$)|english", re.I)),
    ("french", re.compile(r"(?:^|[^a-z])fr(?:[^a-z]|$)|fran|french", re.I)),
]

# What the database's subject names mean, so the two can be compared.
SUBJECT_OF_NAME = {
    "Mathematics": "mathematics", "Mathematiques": "mathematics",
    "Physics": "physics", "Physique": "physics",
    "Chemistry": "chemistry", "Chimie": "chemistry",
    "Life Sciences": "biology", "Sciences de la vie": "biology",
    "Francais": "french", "English": "english",
}


def fold(text: str) -> str:
    return "".join(LETTERS.findall(text.lower()))


def subject_of_paper(path: str) -> str | None:
    name = path.replace(chr(92), "/")
    base = os.path.basename(name)
    for subject, pattern in SUBJECT_OF_PAPER:
        # The filename decides; the folder only ever names a track and a session.
        if pattern.search(base):
            return subject
    return None


def build_index(root: str, cache: str) -> dict[str, str]:
    if cache and os.path.exists(cache):
        with open(cache, "rb") as fh:
            return pickle.load(fh)
    index: dict[str, str] = {}
    for n, path in enumerate(sorted(glob.glob(os.path.join(root, "**", "*.pdf"), recursive=True)), 1):
        try:
            doc = pdfium.PdfDocument(path)
            index[path] = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
        except Exception:
            continue
        if n % 400 == 0:
            print(f"  read {n} papers", flush=True)
    if cache:
        with open(cache, "wb") as fh:
            pickle.dump(index, fh)
    return index


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--questions", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--papers", default="corpus/exams")
    ap.add_argument("--cache", default="")
    args = ap.parse_args()

    rows = json.load(open(args.questions, encoding="utf-8"))
    index = build_index(args.papers, args.cache)
    folded = {path: fold(text) for path, text in index.items()}
    print(f"questions: {len(rows)} | papers: {len(folded)}")

    wrong, agreed, unplaced, unnamed = [], 0, 0, 0
    unnamed_papers: dict[str, int] = {}
    for row in rows:
        body = fold(row.get("body") or "")
        if len(body) < PROBE * 2:
            unplaced += 1
            continue
        probe = body[PROBE : PROBE * 2]
        papers = [p for p, text in folded.items() if probe in text]
        if not papers:
            unplaced += 1
            continue
        subjects = {s for s in (subject_of_paper(p) for p in papers) if s}
        if not subjects:
            # Found the paper, but its filename says nothing we recognise. Worth
            # separating: it is a gap in the name list, not a missing paper.
            unnamed += 1
            for p in papers[:1]:
                base = os.path.basename(p.replace(chr(92), '/'))
                unnamed_papers[base] = unnamed_papers.get(base, 0) + 1
            continue
        filed = SUBJECT_OF_NAME.get(row.get("subject", ""))
        if filed and filed in subjects:
            agreed += 1
            continue
        wrong.append({
            "id": row["id"],
            "filedUnder": row.get("subject"),
            "paperSays": sorted(subjects),
            "papers": [p.replace(chr(92), "/") for p in papers[:3]],
        })

    json.dump(wrong, open(args.out, "w", encoding="utf-8"), indent=1)
    print(f"agreed {agreed} | filed under the wrong subject {len(wrong)}"
          f" | paper not found {unplaced} | paper found but unnamed {unnamed}")
    if unnamed_papers:
        print("  filenames the subject list does not recognise:")
        for base, n in sorted(unnamed_papers.items(), key=lambda kv: -kv[1])[:10]:
            print(f"    {str(n).rjust(4)}  {base}")
    by: dict[str, int] = {}
    for w in wrong:
        key = f"{w['filedUnder']} -> {'/'.join(w['paperSays'])}"
        by[key] = by.get(key, 0) + 1
    for key, n in sorted(by.items(), key=lambda kv: -kv[1])[:15]:
        print(f"  {str(n).rjust(5)}  {key}")
    print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

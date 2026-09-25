# -*- coding: utf-8 -*-
"""The papers whose text layer mis-maps Arabic-Indic digits.

    python scripts/corpus/broken_digits.py            # list them
    python scripts/corpus/broken_digits.py --paths    # paths only, for a run

WHAT IS WRONG WITH THESE PAPERS. Their fonts are `/Identity-H` with no embedded
font file, so the PDF's own `/ToUnicode` map is the only thing that says what a
glyph means — and for the digits it lies. lh/2016 2/geo.pdf prints "المستند رقم
(١)" and every extractor reads "المستند رقم (0)". pypdf, pdfplumber and
pypdfium2 all agree, because they are all reading the same broken map. There is
no glyph program to fall back on, so the page has to be read again.

HOW THEY ARE FOUND, WITHOUT OCR. Documents on a Lebanese paper are numbered 1..N
with no gaps. A reference to "document 0" cannot be real, and neither can a
reference above the count of distinct documents the paper names. Both are proof
the map is wrong, and both are visible in the extractor's existing output.

THIS UNDERSTATES THE DAMAGE and is meant to. A paper whose map swaps ١ and ٣
keeps every number inside the legal range and is not caught here. The list is
the papers that can be PROVEN broken, which is the list it is safe to re-read.
"""
import argparse
import json
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXAMS = json.loads((ROOT / "corpus" / "exams.json").read_text(encoding="utf-8"))

REF = re.compile(r"(?:المستند|المستندين|المستندات|مستند)\s*(?:رقم)?\s*\(?\s*([0-9٠-٩])")
ARABIC_DIGIT = {c: str(i) for i, c in enumerate("٠١٢٣٤٥٦٧٨٩")}

# Accommodation papers — sat under a different and shorter specification. They
# are excluded from this corpus everywhere else, and `reocr_broken_text_layer.py`
# says so in the same words; a re-read that quietly paid for them would undo it.
ACCOMMODATION = ("ehteyejet", "ehtiyejet", "makfufin", "makfoufen", "mu5tasa", "mokhtasa")


def _strings(node) -> list:
    out = []

    def walk(o):
        if isinstance(o, str):
            out.append(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(node)
    return out


def referenced(exam: dict) -> list:
    text = "\n".join(_strings(exam.get("exercises", []))) + "\n" + (exam.get("passage") or "")
    seen = {ARABIC_DIGIT.get(d, d) for d in REF.findall(text)}
    return sorted(int(d) for d in seen)


def broken(exam: dict) -> bool:
    nums = referenced(exam)
    if not nums:
        return False
    # Document 0 does not exist, and a paper cannot cite more documents than it
    # prints. `+ 1` allows the one real case of a gap: a document named in the
    # stimulus and never cited by a numbered question.
    return 0 in nums or max(nums) > len(nums) + 1


def papers() -> list:
    """The broken papers, one per distinct FILE.

    Deduplicated by sha256 because the same PDF is filed under two tracks —
    `gs/2016 1/geo.pdf` and `ls/2016 1/geo.pdf` are one file, and `ocr_pdf.py`
    keys its output by sha, so re-reading both would pay twice for one page.
    """
    out = {}
    for exam in EXAMS:
        if not broken(exam):
            continue
        name = exam["path"].replace("\\", "/").split("/")[-1].lower()
        if any(bad in name for bad in ACCOMMODATION):
            continue
        out.setdefault(exam["sha256"], exam)
    return sorted(out.values(), key=lambda e: e["path"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paths", action="store_true", help="paths only, one per line")
    args = ap.parse_args()

    hits = papers()
    if args.paths:
        for e in hits:
            print(e["path"])
        return

    pages = 0
    for e in hits:
        n = e.get("pages") or 0
        pages += n
        print(f"{e['path']:<36} {e['sha256'][:12]}  {n:>2}p  cites {referenced(e)}")
    print(f"\n{len(hits)} papers, {pages} pages")


if __name__ == "__main__":
    main()

"""
Takes a stored reading passage's text back from the PDF it was printed in.

    python scripts/corpus/reextract_passages.py --passages <in.json> --out <out.json>

WHY. The stored French passages are broken apart mid-word — "nous somm es",
"connai t", "prat iques", "enver s" — at about one word in forty, which is what
makes them hard to read. The damage is NOT in the paper: the PDF's own text
layer says "nous sommes" and "connait". It was introduced somewhere in our
extraction, and since the correct text is still sitting in the PDF, it can
simply be taken back rather than repaired by guesswork.

HOW IT FINDS THE RIGHT PLACE. Both texts are folded to letters alone, which is
what makes the comparison survive the damage: "somm es" and "sommes" are the
same string once the spaces are gone. The passage's first and last sixty letters
locate it in the paper, and everything between them is returned in the PDF's own
spelling.

THE GATE IS THAT THE LETTERS MUST MATCH EXACTLY. A rebuilt passage is accepted
only when its letters, ignoring every space, are identical to the stored one's.
That makes this incapable of changing a word: it can only change where the
spaces fall. Anything that does not match exactly is reported and skipped.

The paper's furniture — the Arabic cover lines and the margin gutter — comes
back with the text, and is removed afterwards by `clean-exam-passages.ts`, which
already knows how.
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
# The gate compares LATIN letters only. The stretch of paper holding the
# passage can also hold the Arabic cover lines, whose letters would make an
# otherwise perfect rebuild look different; that furniture is stripped
# afterwards by `clean-exam-passages.ts`. Latin letters are the French text,
# and they are what must not change.
LATIN = re.compile(r"[A-Za-zÀ-ÿ]")

# Long enough to be unique in a paper, short enough to survive the damage at
# either end of the passage.
PROBE = 60


def fold(text: str) -> tuple[str, list[int]]:
    """The text's letters alone, with a map back to where each came from."""
    keep: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(text):
        if LETTERS.match(ch):
            keep.append(ch.lower())
            index.append(i)
    return "".join(keep), index


def latin_only(text: str) -> str:
    """What the gate compares: the passage's own letters, nothing else."""
    return "".join(LATIN.findall(text.lower()))


def document_text(path: str) -> str:
    doc = pdfium.PdfDocument(path)
    return "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))


def build_index(root: str, cache: str) -> dict[str, str]:
    """Every paper's text, read once and kept, because this runs over hundreds."""
    if cache and os.path.exists(cache):
        with open(cache, "rb") as fh:
            return pickle.load(fh)

    index: dict[str, str] = {}
    papers = sorted(glob.glob(os.path.join(root, "**", "*.pdf"), recursive=True))
    for n, path in enumerate(papers, 1):
        try:
            index[path] = document_text(path)
        except Exception:
            continue
        if n % 200 == 0:
            print(f"  read {n}/{len(papers)} papers", flush=True)
    if cache:
        with open(cache, "wb") as fh:
            pickle.dump(index, fh)
    return index


def reextract(pdf_text: str, stored: str) -> str | None:
    folded_pdf, idx = fold(pdf_text)
    folded_stored, _ = fold(stored)
    if len(folded_stored) < PROBE * 2:
        return None

    start = folded_pdf.find(folded_stored[:PROBE])
    if start < 0:
        return None
    end = folded_pdf.find(folded_stored[-PROBE:], start)
    if end < 0:
        return None
    last = min(end + PROBE - 1, len(idx) - 1)
    return pdf_text[idx[start] : idx[last] + 1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--passages", required=True, help="[{id, passage}] to rebuild")
    ap.add_argument("--out", required=True)
    ap.add_argument("--papers", default="corpus/exams")
    ap.add_argument("--cache", default="")
    args = ap.parse_args()

    rows = json.load(open(args.passages, encoding="utf-8"))
    print(f"passages to rebuild: {len(rows)}")
    index = build_index(args.papers, args.cache)
    print(f"papers indexed: {len(index)}")

    # Folding every paper once, rather than once per passage.
    folded = {path: fold(text)[0] for path, text in index.items()}

    rebuilt, not_found, mismatched = [], [], []
    for row in rows:
        stored = row.get("passage") or ""
        target, _ = fold(stored)
        if len(target) < PROBE * 2:
            not_found.append(row["id"])
            continue
        head = target[:PROBE]

        answers = [p for p, f in folded.items() if head in f]
        got = None
        for path in answers:
            candidate = reextract(index[path], stored)
            if not candidate:
                continue
            # THE GATE. Same letters, ignoring every space, or it is not accepted.
            if latin_only(candidate) == latin_only(stored):
                got = (path, candidate)
                break

        if not got:
            (mismatched if answers else not_found).append(row["id"])
            continue
        rebuilt.append({"id": row["id"], "paper": got[0].replace(chr(92), "/"), "passage": got[1]})

    json.dump(rebuilt, open(args.out, "w", encoding="utf-8"), indent=1)
    print(f"rebuilt {len(rebuilt)}; paper not found {len(not_found)}; letters did not match {len(mismatched)}")
    print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

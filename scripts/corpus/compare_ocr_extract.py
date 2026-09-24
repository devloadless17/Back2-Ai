# -*- coding: utf-8 -*-
"""Would the OCR transcription extract better than the PDF's own text layer?

    python scripts/corpus/compare_ocr_extract.py            # all papers
    python scripts/corpus/compare_ocr_extract.py --limit 20

Measures, it does not decide. Runs the real extractor (`extract_exams.read`)
three ways on every Arabic-taught paper that `ocr_exams_batch.py` transcribed:

  layer   the PDF's own text layer, as today
  ocr     the transcription, substituted whole
  joined  the transcription with each stand-alone mark line glued back onto
          the line above it

Why `joined` exists. Measured on lh/2016 2/geo.pdf: substituting a
transcription whole took the paper from 9 sub-questions to 0, because the text
layer prints "(ثلاث علامات)" on the question's own line and the transcription
puts it on a line by itself, so every mark-gated header rule stops seeing it.

The extractor file is not modified. The transcription is fed in by standing a
fake reader in for `PdfReader`, so `read()` runs exactly as it does today.
Writes corpus/exams-ocr/compare.json and prints a summary.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_exams as ee  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OCR = ROOT / "corpus" / "exams-ocr"

# A line that is only a mark: "(ثلاث علامات)", "(علامة ونصف)", "3 علامات", "( 1.5 علامة )".
MARK_LINE = re.compile(r"^\s*[\(\)]?\s*[^\n()]{0,25}?علام[^\n()]{0,25}?\s*[\(\)]?\s*$")

# Damage the text layer produces and a transcription should not: a vowel mark
# torn from its letter, Urdu heh, a mirrored mark bracket, the scrambled header.
DAMAGE = re.compile(r" [ً-ْ]|ھ|\)(?:علام|ثلاث)|ـلام[^ ]*\)|الوديرية|اهتحان|العبهة")


def join_marks(page: str) -> str:
    out = []
    for line in page.split("\n"):
        if out and MARK_LINE.match(line) and out[-1].strip():
            out[-1] = out[-1].rstrip() + " " + line.strip()
        else:
            out.append(line)
    return "\n".join(out)


class FakePage:
    def __init__(self, text):
        self.text = text

    def extract_text(self):
        return self.text


class FakeReader:
    pages_for = None

    def __init__(self, _pdf):
        self.pages = [FakePage(t) for t in FakeReader.pages_for]


def measure(result) -> dict:
    if not result or "error" in result:
        return {"error": (result or {}).get("error", "none")}
    ex = result["exercises"]
    text = " ".join(e.get("statement", "") + " " + " ".join(p.get("text", "") for p in e["parts"]) for e in ex)
    return {
        "exercises": len(ex),
        "parts": sum(len(e["parts"]) for e in ex),
        "marks": result["totalMarks"],
        "partMarks": result["marksFound"],
        "answers": result["answersFound"],
        "damage": len(DAMAGE.findall(text)),
        "chars": len(text),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    ee.NO_TABLES = True  # geometric mark reading is the same for every variant
    real_reader = ee.PdfReader
    index = json.loads((OCR / "index.json").read_text("utf-8"))
    one_per_sha = {}
    for rel, sha in sorted(index.items()):
        one_per_sha.setdefault(sha, rel)
    items = list(one_per_sha.items())[: args.limit or None]

    rows = []
    for n, (sha, rel) in enumerate(items, 1):
        pdf = ROOT / rel
        pages = sorted((OCR / sha).glob("page-*.md"))
        ocr_pages = [p.read_text("utf-8") for p in pages]
        row = {"path": rel, "sha8": sha}
        ee.PdfReader = real_reader
        row["layer"] = measure(ee.read(pdf))
        for name, text in (("ocr", ocr_pages), ("joined", [join_marks(p) for p in ocr_pages])):
            FakeReader.pages_for = text
            ee.PdfReader = FakeReader
            try:
                row[name] = measure(ee.read(pdf))
            except Exception as exc:  # a variant crashing is a result, not a stop
                row[name] = {"error": f"crash {type(exc).__name__}"}
        ee.PdfReader = real_reader
        rows.append(row)
        if n % 20 == 0:
            print(f"  {n}/{len(items)}", flush=True)

    (OCR / "compare.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), "utf-8")

    def ok(m):
        return "error" not in m

    print(f"\n{len(rows)} unique papers")
    for v in ("layer", "ocr", "joined"):
        good = [r[v] for r in rows if ok(r[v])]
        print(
            f"  {v:6}  extracted {len(good):3}  errors {len(rows) - len(good):3}"
            f"  parts {sum(m['parts'] for m in good):5}  part-marks {sum(m['partMarks'] for m in good):5}"
            f"  damage {sum(m['damage'] for m in good):5}"
        )


if __name__ == "__main__":
    main()

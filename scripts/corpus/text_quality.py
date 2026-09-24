# -*- coding: utf-8 -*-
"""Ranks the pages of a book by how likely their OCR text is wrong.

    python scripts/corpus/text_quality.py geographie__231a8f14 [...]

Signals per page, none of which needs another OCR pass:

  conf      the reader's mean confidence (Document AI / Mathpix sidecar)
  low       share of tokens the reader itself scored low
  odd       share of words that occur only once across every book in the
            same language. Misread words are almost always one-offs; real
            words repeat somewhere in 40,000 pages of the same subject area.
  script    share of letters in the wrong script (Latin inside Arabic text,
            Arabic inside Latin), the usual sign of a garbled line
  chars     page length, to catch pages read as nearly empty

The ranking only picks which pages to look at. Whether a page is actually
wrong is decided by comparing it with the scan, by eye.

Writes corpus/page-audit/text-quality/<book>.json.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT = ROOT / "corpus" / "text"
META = ROOT / "corpus" / "meta"
OUT = ROOT / "corpus" / "page-audit" / "text-quality"

AR = re.compile(r"[؀-ۿ]")
LAT = re.compile(r"[A-Za-zÀ-ÿ]")
TASHKEEL = re.compile(r"[ً-ْٰـ]")


def fold(word):
    w = TASHKEEL.sub("", word.lower())
    return w.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")


def words(text):
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)|https?://\S+|\$[^$]*\$", " ", text)
    return [fold(w) for w in re.findall(r"[ء-يٰـً-ْ]{2,}|[A-Za-zÀ-ÿ'’-]{3,}", text)]


def pages_of(book):
    d = TEXT / book / "clean"
    if not d.exists():
        d = TEXT / book
    return {int(p.stem[5:]): p.read_text(encoding="utf-8") for p in sorted(d.glob("page-*.md"))}


def language_of(pages):
    t = "".join(pages.values())
    return "ar" if len(AR.findall(t)) > len(LAT.findall(t)) else "latin"


def vocabulary(lang):
    """Word counts across every book in corpus/text of the same script."""
    counts = Counter()
    for d in TEXT.iterdir():
        if not d.is_dir():
            continue
        src = d / "clean" if (d / "clean").exists() else d
        files = list(src.glob("page-*.md"))
        if len(files) < 20:  # skip exam papers and tests
            continue
        sample = "".join(f.read_text(encoding="utf-8") for f in files[:15])
        if ("ar" if len(AR.findall(sample)) > len(LAT.findall(sample)) else "latin") != lang:
            continue
        for f in files:
            counts.update(words(f.read_text(encoding="utf-8")))
    return counts


def survey(book, vocab):
    pages = pages_of(book)
    lang = language_of(pages)
    rows = []
    for n, text in pages.items():
        ws = words(text)
        meta = META / book / f"page-{n:03d}.json"
        m = json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {}
        letters = len(AR.findall(text)) + len(LAT.findall(text))
        wrong = len(LAT.findall(text)) if lang == "ar" else len(AR.findall(text))
        odd = [w for w in ws if vocab[w] <= 1]
        rows.append({
            "page": n, "chars": len(text.strip()),
            "conf": m.get("meanConfidence"), "low": m.get("lowConfidenceTokenRatio"),
            "odd": round(len(odd) / len(ws), 3) if ws else None,
            "script": round(wrong / letters, 3) if letters else None,
            "oddWords": odd[:25],
        })
    def badness(r):
        if not r["chars"] or r["odd"] is None:
            return -1
        return (r["odd"] or 0) * 2 + (r["low"] or 0) + (1 - (r["conf"] or 1)) + (r["script"] or 0)
    rows.sort(key=badness, reverse=True)
    body = [r for r in rows if r["odd"] is not None and r["chars"] > 150]
    summary = {
        "book": book, "language": lang, "pages": len(pages),
        "medianOdd": sorted(r["odd"] for r in body)[len(body) // 2] if body else None,
        "meanConf": round(sum(r["conf"] for r in body if r["conf"]) / max(1, sum(1 for r in body if r["conf"])), 3),
        "worst": [r["page"] for r in rows[:12]],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{book}.json").write_text(json.dumps({"summary": summary, "pages": rows}, ensure_ascii=False, indent=1),
                                      encoding="utf-8")
    return summary


def main():
    books = sys.argv[1:]
    vocabs = {}
    for b in books:
        lang = language_of(pages_of(b))
        if lang not in vocabs:
            vocabs[lang] = vocabulary(lang)
        s = survey(b, vocabs[lang])
        print(f"{b:34s} {s['language']:5s} pages={s['pages']:4d} meanConf={s['meanConf']} "
              f"medianOdd={s['medianOdd']} worst={s['worst']}")


if __name__ == "__main__":
    main()

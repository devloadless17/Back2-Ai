# -*- coding: utf-8 -*-
"""Removes lines that are text printed inside photos and figures.

    python scripts/corpus/filter_figure_text.py <book> [...]           dry run: list what would go
    python scripts/corpus/filter_figure_text.py <book> [...] --apply

Document AI reads every letter on the page, including the label on a deodorant
can in a civics lesson and the letters of an alphabet chart in philosophy.
Those lines land in the passages between real sentences. After
relayout_docai.py each printed line is its own line, so a line can be judged
on its own. A line is dropped when it is:

  latin-in-arabic   an Arabic book's line whose letters are mostly Latin, with
                    no Arabic word longer than two letters (Arabic sentences
                    quoting a French term keep plenty of Arabic around it)
  fragments         three or more tokens, most of them one or two characters
                    and not numbers (chart and map debris; tables of numbers
                    are kept)
  unknown-words     in a Latin-script book, a short line (up to six words)
                    where fewer than a third of the words occur three or more
                    times across the corpus

Pages transcribed by hand (corpus/page-audit/transcribed) are never touched.
Every dropped line goes to corpus/page-audit/figure-text/<book>.json, and the
original pages are copied to corpus/page-audit/backup/figure-text/<book>/
before the first write.
"""

import json
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "corpus"))
from text_quality import TEXT, fold, language_of, pages_of, vocabulary  # noqa: E402

AUDIT = ROOT / "corpus" / "page-audit"
AR = re.compile(r"[ء-ي]")
LAT = re.compile(r"[A-Za-zÀ-ÿ]")


REAL_SHORT = {"a", "i", "to", "at", "of", "in", "on", "is", "or", "no", "an", "as", "by", "it", "we",
              "ou", "et", "le", "la", "de", "un", "à", "en", "du", "il", "ne", "se", "y", "l'", "d'"}
ODD = re.compile(r"[^\s\w.,;:!?()'\"«»\-–—=/%²³+*؀-ۿ]")


def verdict(line, lang, vocab):
    t = line.strip()
    if not t or t.startswith("#"):
        return None
    tokens = t.split()
    ar = len(AR.findall(t))
    lat = len(LAT.findall(t))
    if lang == "ar" and lat and ar == 0:
        # Latin inside an Arabic book is usually a term, a name or a
        # reference, and stays. Only three shapes are picture text: stray
        # letters, symbol soup, and all-capital label or speech-bubble lines.
        letters = re.sub(r"[^A-Za-zÀ-ÿ]", "", t)
        if len(tokens) == 1 and len(letters) <= 3 and "=" not in t:
            return "latin-in-arabic"
        if ODD.search(t):
            return "latin-in-arabic"
        if len(tokens) >= 2 and letters.isupper() and len(letters) >= 6:
            return "latin-in-arabic"
        return None
    if len(tokens) >= 3 and ar == 0:
        short = [w for w in tokens if len(w) <= 2
                 and not re.fullmatch(r"[\d٠-٩۰-۹.,٫%()\-–]+|[A-Za-z0-9][.)]|[?!:;]", w)
                 and w.lower() not in REAL_SHORT]
        if len(short) / len(tokens) > 0.6:
            return "fragments"
    # No rule on rare words in English or French: checked against the
    # scans, the lines it caught were vocabulary exercises, headings and
    # quoted literature. A textbook's rare words are what it teaches.
    return None


def main():
    books = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply = "--apply" in sys.argv
    vocabs = {}
    for book in books:
        lang = language_of(pages_of(book))
        key = "ar" if lang == "ar" else "latin"
        if key not in vocabs:
            vocabs[key] = vocabulary(key) if key == "latin" else Counter()
        vocab = vocabs[key]
        hand = {p.name for p in (AUDIT / "transcribed" / book).glob("page-*.md")} \
            if (AUDIT / "transcribed" / book).exists() else set()
        tdir = TEXT / book
        report, total = {}, Counter()
        for path in sorted(tdir.glob("page-*.md")):
            if path.name in hand:
                continue
            lines = path.read_text(encoding="utf-8").split("\n")
            keep, gone = [], []
            for line in lines:
                v = verdict(line, lang, vocab)
                if v:
                    gone.append({"line": line, "why": v})
                    total[v] += 1
                else:
                    keep.append(line)
            if gone:
                report[path.stem] = gone
                if apply:
                    backup = AUDIT / "backup" / "figure-text" / book
                    backup.mkdir(parents=True, exist_ok=True)
                    if not (backup / path.name).exists():
                        shutil.copyfile(path, backup / path.name)
                    path.write_text(re.sub(r"\n{3,}", "\n\n", "\n".join(keep)), encoding="utf-8")
        out = AUDIT / "figure-text" / f"{book}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{book:36s} {sum(total.values()):5d} lines on {len(report):3d} pages  {dict(total)}"
              + ("" if apply else "  (dry run)"))


if __name__ == "__main__":
    main()

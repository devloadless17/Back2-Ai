# -*- coding: utf-8 -*-
"""Walks a book's text alongside its scan, page by page, for correction by eye.

    python scripts/corpus/compare_walk.py <book> show <printed page>   scan halves + next text
    python scripts/corpus/compare_walk.py <book> fix "<old>" "<new>"    replace once, after the cursor
    python scripts/corpus/compare_walk.py <book> next "<last words>"    move past the page's last words
    python scripts/corpus/compare_walk.py <book> where                  cursor position

For a book whose stored pages do not match the scan's pages (Arabic
literature was imported from a Word file, 107 synthetic pages for a 200-page
scan), the only way to compare is in reading order: show a scan page, show
the stored text from where the last page ended, correct what differs, then
advance past that page's last words. The raw page files are edited in place
(corpus/text/<book>/page-NNN.md); a copy of every file is kept before the
first edit, and every correction is logged to
corpus/page-audit/compare/<book>.json.
"""

import json
import re
import shutil
import sys
from pathlib import Path

import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = Path("C:/Users/96181/AppData/Local/Temp/claude/c--Users-96181-bac2/"
               "c982192f-2d39-400d-b3f6-de98c6f9cc11/scratchpad/img")
BOOKS = {
    "arabic-lit-gsls-se__58bea168": (ROOT / "corpus/crdp ebooks/LS/EN/arabe.pdf",
                                     ROOT / "corpus/page-audit/manual/e20f814d.json"),
}
SEP = "\n\u2063PAGE {}\u2063\n"
SEP_RE = re.compile("\n\u2063PAGE (\\d+)\u2063\n")
DIAC = re.compile(r"[\u064B-\u0652\u0670\u0640]")


def load(book):
    d = ROOT / "corpus" / "text" / book
    files = sorted(d.glob("page-*.md"))
    return "".join(SEP.format(f.stem[5:]) + f.read_text(encoding="utf-8") for f in files)


def save(book, combined):
    d = ROOT / "corpus" / "text" / book
    parts = SEP_RE.split(combined)
    for i in range(1, len(parts), 2):
        (d / f"page-{parts[i]}.md").write_text(parts[i + 1], encoding="utf-8")


def state_path(book):
    p = ROOT / "corpus" / "page-audit" / "compare" / f"{book}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def state(book):
    p = state_path(book)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"cursor": 0, "log": []}


def fold(s):
    s = DIAC.sub("", s)
    return s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")


def locate(text, needle, start):
    """Index of needle at or after start, ignoring diacritics and spacing."""
    idx = [i for i, c in enumerate(text) if not DIAC.match(c) and not c.isspace()]
    flat = "".join(text[i] for i in idx)
    ftarget = "".join(c for c in fold(needle) if not c.isspace())
    fflat = fold(flat)
    k0 = next((k for k, i in enumerate(idx) if i >= start), len(idx))
    k = fflat.find(ftarget, k0)
    if k < 0:
        return -1, -1
    return idx[k], idx[k + len(ftarget) - 1] + 1


def main():
    book, cmd, *rest = sys.argv[1:]
    sys.stdout.reconfigure(encoding="utf-8")
    st = state(book)
    text = load(book)
    if cmd == "show":
        pdf, manual = BOOKS[book]
        m = json.loads(manual.read_text(encoding="utf-8"))
        inv = {v: int(k) for k, v in m.items() if not k.startswith("_") and isinstance(v, int)}
        # "s11" names a scan page directly (for pages that print no number).
        n = rest[0]
        scan = int(n[1:]) if n.startswith("s") else inv[int(n)]
        im = pdfium.PdfDocument(str(pdf))[scan - 1].render(scale=2.1).to_pil()
        w, h = im.size
        im.crop((0, 0, w, int(h * .52))).save(SCRATCH / "cw-a.png")
        im.crop((0, int(h * .48), w, h)).save(SCRATCH / "cw-b.png")
        end = st["cursor"] + (int(rest[1]) if len(rest) > 1 else 2600)
        chunk = text[st["cursor"]:end]
        print(f"[printed {n}, scan {scan}, cursor {st['cursor']}]")
        print(SEP_RE.sub(lambda m: f"\n<<page {m.group(1)}>>\n", chunk))
    elif cmd == "fix":
        old, new = rest
        a, z = locate(text, old, st["cursor"])
        if a < 0:
            sys.exit(f"not found after cursor: {old}")
        backup = ROOT / "corpus" / "page-audit" / "backup" / "compare" / book
        if not backup.exists():
            backup.mkdir(parents=True)
            for f in (ROOT / "corpus" / "text" / book).glob("page-*.md"):
                shutil.copyfile(f, backup / f.name)
        was = text[a:z]
        text = text[:a] + new + text[z:]
        save(book, text)
        st["log"].append({"was": was, "now": new, "at": a})
        state_path(book).write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"fixed: «{was}» -> «{new}»")
    elif cmd == "next":
        a, z = locate(text, rest[0], st["cursor"])
        if a < 0:
            sys.exit(f"not found after cursor: {rest[0]}")
        st["cursor"] = z
        state_path(book).write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"cursor -> {z}; next: {text[z:z+80]!r}")
    elif cmd == "seek":
        # Jump to a passage anywhere in the book (pages stored out of order).
        a, z = locate(text, rest[0], 0)
        if a < 0:
            sys.exit(f"not found: {rest[0]}")
        st["cursor"] = a
        state_path(book).write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"cursor -> {a}; next: {text[a:a+80]!r}")
    elif cmd == "where":
        print(st["cursor"], repr(text[st["cursor"]:st["cursor"] + 120]))


if __name__ == "__main__":
    main()

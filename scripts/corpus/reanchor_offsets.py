# -*- coding: utf-8 -*-
"""Moves a taxonomy's in-page chapter edges to follow edited text.

    python scripts/corpus/reanchor_offsets.py <book> <old raw pages dir>          dry run
    python scripts/corpus/reanchor_offsets.py <book> <old raw pages dir> --apply

A chapter that starts or stops part-way down a page stores that point as a
character offset into the page's clean text (pdfOffset / pdfEndOffset, read by
load-chunks.ts). Correcting the page text by hand (compare_walk.py) changes
the page's length, so the stored offset lands somewhere else: a few characters
early or late, and after a large insertion, inside another chapter's text.

The old offset is turned back into words: the text that followed it in the
page as it was (the raw pages backed up before the first correction, cleaned
the same way normalise.py cleans them). Those words are then found in the
page as it is now, ignoring diacritics and spacing, and their position becomes
the new offset. An edge whose words were themselves corrected away is reported
and left alone, to be set by hand.
"""

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "corpus"))
from normalise import to_markdown  # noqa: E402

DIAC = re.compile(r"[ً-ْٰـ]")


def fold(s):
    s = DIAC.sub("", s)
    return s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")


def find(text, needle):
    """Offset in text where needle starts, ignoring diacritics and spacing."""
    idx = [i for i, c in enumerate(text) if not DIAC.match(c) and not c.isspace()]
    flat = fold("".join(text[i] for i in idx))
    target = fold("".join(c for c in needle if not c.isspace() and not DIAC.match(c)))
    if not target:
        return None
    k = flat.find(target)
    if k < 0 or flat.find(target, k + 1) >= 0:
        return None  # missing, or not unique on the page
    return idx[k]


def locate(old_text, off, new_text):
    """New offset for the point that was at off in old_text."""
    if off <= 0:
        return 0, "top"
    if off >= len(old_text):
        return len(new_text), "end"
    # Try the words right after the edge, then right before it.
    for n in (60, 40, 25, 15):
        after = old_text[off:off + n]
        k = find(new_text, after)
        if k is not None:
            return k, f"after:{after.strip()[:30]!r}"
    for n in (60, 40, 25):
        before = old_text[max(0, off - n):off]
        k = find(new_text, before)
        if k is not None:
            # the edge sits right after these words
            flat_len = len([c for c in before if not DIAC.match(c) and not c.isspace()])
            j, seen = k, 0
            while j < len(new_text) and seen < flat_len:
                if not DIAC.match(new_text[j]) and not new_text[j].isspace():
                    seen += 1
                j += 1
            while j < len(new_text) and DIAC.match(new_text[j]):
                j += 1
            return j, f"before:{before.strip()[-30:]!r}"
    return None, "lost"


def main():
    book, old_dir = sys.argv[1], Path(sys.argv[2])
    apply = "--apply" in sys.argv
    tax_path = ROOT / "corpus" / "taxonomy" / f"{book}.json"
    tax = json.loads(tax_path.read_text(encoding="utf-8"))
    clean = ROOT / "corpus" / "text" / book / "clean"
    stats = {"cdnLinksRemaining": 0}

    def old_page(p):
        f = old_dir / f"page-{p:03d}.md"
        return to_markdown(f.read_text(encoding="utf-8"), book, stats) if f.exists() else ""

    def new_page(p):
        f = clean / f"page-{p:03d}.md"
        return f.read_text(encoding="utf-8") if f.exists() else ""

    changes, lost = 0, 0
    for ch in tax["chapters"]:
        for page_key, off_key in (("pdfPage", "pdfOffset"), ("pdfPageEnd", "pdfEndOffset")):
            off = ch.get(off_key)
            p = ch.get(page_key)
            if not off or p is None:
                continue
            new, how = locate(old_page(p), off, new_page(p))
            tag = f"{ch['index']:>2} {off_key:13s} p{p:03d} {off:>5} -> "
            if new is None:
                lost += 1
                print(tag + "LOST  " + repr(old_page(p)[off:off + 50]))
                continue
            if new != off:
                changes += 1
                ch[off_key] = new
            print(tag + f"{new:>5}  {how}")
    print(f"{changes} edge(s) moved, {lost} lost" + ("" if apply else "  (dry run)"))
    if apply and changes:
        backup = ROOT / "corpus" / "page-audit" / "backup" / "taxonomy" / f"{book}.before-reanchor.json"
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copyfile(tax_path, backup)
        tax_path.write_text(json.dumps(tax, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

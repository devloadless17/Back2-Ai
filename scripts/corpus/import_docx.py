# -*- coding: utf-8 -*-
"""Imports a .docx conversion of a book into the corpus.

    python scripts/corpus/import_docx.py --list
    python scripts/corpus/import_docx.py --file "corpus/ls-gs-json/kawa3ed.docx" --name arabic-grammar-lh
    python scripts/corpus/import_docx.py --all

Some books reached this project as Word documents rather than as Document AI
JSON — the reader's output was exported to .docx and the JSON was not kept. The
text is sound, so there is nothing to re-read and nothing to pay for; it only
needs to land in the same shape as every other book, which is one Markdown file
per page under corpus/text/<book>/.

The catch is that a .docx has no pages. Word paginates at display time, and
these files carry no page breaks and only a scattering of printed page labels —
137 of them in a book of roughly three hundred pages. So the page numbering
here is SYNTHETIC: the text is cut at the printed labels where they exist, and
otherwise every PARAGRAPHS_PER_PAGE paragraphs.

That matters for one thing only, and it is worth being plain about it. Chapter
placement and retrieval both work on the text, so they are unaffected. But the
page recorded against a chunk is an approximation, and a citation of the form
"page 84 of the Arabic literature book" cannot be trusted the way it can for a
book imported from a PDF. Anything that shows a student a page number should
say where the number came from, or not show it for these three books.
"""

import argparse
import hashlib
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
TEXT = CORPUS / "text"

PARAGRAPHS_PER_PAGE = 22

PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)
RUN = re.compile(r"<w:t[^>]*>([^<]*)</w:t>")
TAB = re.compile(r"<w:tab[ /]")
# "صفحة 42", "page 42", "الصفحة 42" — the printed folio, where the reader kept it.
PAGE_LABEL = re.compile(r"^\s*(?:#+\s*)?(?:page|الصفحة|صفحة)\s*[:\-—]?\s*(\d{1,3})\s*$", re.I)
HEADING = re.compile(r"^\s*#{1,4}\s+")

# Books whose .docx is the only copy, with the tracks printed on their covers.
KNOWN = [
    {
        "file": "corpus/ls-gs-json/arabe ls gs se.docx",
        "name": "arabic-lit-gsls-se",
        "subject": "Langue arabe",
        "language": "ar",
        "tracks": "GS;LS;SE",
        "note": "Cover: الأدب العربي، فروع الاجتماع والاقتصاد، العلوم العامة - علوم الحياة.",
    },
    {
        "file": "corpus/lh-json/arabe lh.docx",
        "name": "arabic-lit-lh",
        "subject": "Langue arabe",
        "language": "ar",
        "tracks": "LH",
        "note": "Cover: الأدب العربي، فرع الآداب والإنسانيات.",
    },
    {
        "file": "corpus/ls-gs-json/kawa3ed.docx",
        "name": "arabic-grammar-lh",
        "subject": "Langue arabe",
        "language": "ar",
        "tracks": "LH",
        "note": "Cover: قواعد اللغة العربية والبلاغة والعروض، فرع الآداب والإنسانيات.",
    },
]


def paragraphs(path: Path) -> list:
    """Every paragraph's text, in order, with tabs preserved as spaces."""
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")

    out = []
    for block in PARA.findall(xml):
        block = TAB.sub(" <w:t> </w:t><w:x ", block)
        text = "".join(RUN.findall(block))
        text = unicodedata.normalize("NFC", text).replace(" ", " ")
        out.append(re.sub(r"[ \t]+", " ", text).strip())
    return out


def paginate(paras: list) -> list:
    """Cut the paragraph stream into pages.

    A printed page label starts a new page and is not kept — it is the reader's
    marker, not the book's prose. Between labels, or where a book has none, the
    stream is cut every PARAGRAPHS_PER_PAGE paragraphs so no single file grows
    to the size of a chapter.
    """
    pages, current, count = [], [], 0

    for para in paras:
        if not para:
            continue
        if PAGE_LABEL.match(para):
            if current:
                pages.append(current)
            current, count = [], 0
            continue
        current.append(para)
        count += 1
        if count >= PARAGRAPHS_PER_PAGE and not HEADING.match(para):
            pages.append(current)
            current, count = [], 0

    if current:
        pages.append(current)
    return pages


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")


def import_one(spec: dict) -> dict | None:
    source = ROOT / spec["file"]
    if not source.exists():
        print(f"  {spec['file']}: not found")
        return None

    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    folder = f"{slugify(spec['name'])}__{sha[:8]}"
    target = TEXT / folder
    target.mkdir(parents=True, exist_ok=True)

    paras = paragraphs(source)
    pages = paginate(paras)

    for index, page in enumerate(pages, start=1):
        (target / f"page-{index:03d}.md").write_text("\n\n".join(page) + "\n", encoding="utf-8")

    meta_dir = CORPUS / "meta" / folder
    meta_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "book": folder,
        "sha256": sha,
        "source": spec["file"],
        "reader": "docx (exported from google-document-ai)",
        "pages": len(pages),
        "pagesAreSynthetic": True,
        "paragraphs": sum(1 for p in paras if p),
        "characters": sum(len(p) for p in paras),
        "subject": spec["subject"],
        "language": spec["language"],
        "tracks": spec["tracks"],
        "note": spec["note"],
    }
    (meta_dir / "import.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"  {folder:<34}{len(pages):>4} pages  {meta['characters']:>8} chars  {spec['tracks']}")
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--file")
    ap.add_argument("--name")
    args = ap.parse_args()

    if args.list:
        for spec in KNOWN:
            exists = "found" if (ROOT / spec["file"]).exists() else "MISSING"
            print(f"  {spec['name']:<22}{spec['tracks']:<12}{exists:<8}{spec['file']}")
        return

    if args.file:
        spec = {
            "file": args.file,
            "name": args.name or Path(args.file).stem,
            "subject": "",
            "language": "ar",
            "tracks": "",
            "note": "",
        }
        import_one(spec)
        return

    if args.all:
        done = [m for m in (import_one(s) for s in KNOWN) if m]
        print()
        print(f"{len(done)} book(s), {sum(m['pages'] for m in done)} synthetic pages imported")
        print("Pages are synthetic — see the module docstring before citing one to a student.")
        return

    ap.print_help()


if __name__ == "__main__":
    sys.exit(main())

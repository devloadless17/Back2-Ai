# -*- coding: utf-8 -*-
"""Imports Google Document AI output into the corpus.

    python scripts/corpus/import_docai.py --list
    python scripts/corpus/import_docai.py --folder "tarbeya ls-gs"
    python scripts/corpus/import_docai.py --all
    python scripts/corpus/import_docai.py --all --images     # also save page scans

Document AI was run separately on the Arabic and language books; the results
are folders of JSON, one file per batch of pages. This turns them into the same
layout the Mathpix runner produces, so gates.py, taxonomy.py and everything
downstream treat both readers identically.

Costs nothing: the OCR is already paid for and this only reads files.

Two things this has to get right, and both are checked rather than assumed:

  ordering   page numbers restart at 1 in every file, so a book is the files
             concatenated in sequence. The order is verified afterwards by
             reading the page numbers the book itself prints.
  language   detected from the text, not from the folder name.
"""

import argparse
import base64
import hashlib
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CORPUS = ROOT / "corpus"
SOURCE = Path("C:/Users/96181/Music")

# folder -> what the book is. Page counts are from the tracking sheet; the
# importer reports the real count so the two can be compared.
#
# The same folder name appears in more than one tree (geo-se, tarbeya) because
# those books are shared across tracks. They are byte-identical, so they hash
# to the same book and import once — whichever tree they are read from.
BOOKS = {
    # GS / LS
    "eng":            ("themes-gsls-en", "English", "GS;LS", 139),
    "eng2":           ("themes-workbook-gsls-en", "English", "GS;LS", 203),
    "fr-gs-ls":       ("francais-gsls-fr", "Francais", "GS;LS", 147),
    "falsafe ls-gs":  ("falsafa-gsls", "Philosophie", "GS;LS", 203),
    # shared by every track
    "geo-se":         ("geographie", "Geographie", "GS;LS;SE;LH", 113),
    "tarbeya ls-gs":  ("tarbiya", "Education civique", "GS;LS;SE;LH", 209),
    # LH
    "falsafe 3ame":   ("falsafa-3amma-lh", "Philosophie", "LH", 361),
    "falsafe-lh":     ("falsafa-arabiya-lh", "Philosophie", "LH", 265),
    "fr1-lh":         ("francais-plaisir-lh", "Francais", "LH", 316),
    "fr2-lh":         ("francais-oeuvre-lh", "Francais", "LH", 252),
    "theme1-lh":      ("themes-lh-en", "English", "LH", 346),
    "theme2-lh":      ("themes2-lh-en", "English", "LH", 331),
    "theme-w":        ("themes-workbook-lh-en", "English", "LH", 329),
    # SE
    "ejteme3-se":     ("ejtema3-se", "Sociologie", "SE", 315),
    "eng-se":         ("themes-se-en", "English", "SE", 148),
    "eng-w-se":       ("themes-workbook-se-en", "English", "SE", 111),
    "french-se":      ("francais-se-fr", "Francais", "SE", 228),
}

LOW_CONFIDENCE = 0.7


def order_key(path: Path):
    """document.json first, then document (1), (2), ... in numeric order."""
    m = re.search(r"\((\d+)\)", path.name)
    return (1, int(m.group(1))) if m else (0, 0)


def page_text(doc_text: str, layout: dict) -> str:
    """Document AI stores the text once and points into it with offsets."""
    segments = (layout or {}).get("textAnchor", {}).get("textSegments", [])
    return "".join(
        doc_text[int(s.get("startIndex", 0)):int(s.get("endIndex", 0))] for s in segments
    )


def script_of(text: str) -> str:
    """Which script dominates — so the language comes from the text, not a folder name."""
    arabic = sum(1 for c in text if "\u0600" <= c <= "\u06ff")
    latin = sum(1 for c in text if c.isascii() and c.isalpha())
    if arabic > latin:
        return "ar"
    # French vs English: accented letters are the cheap discriminator
    accents = sum(1 for c in text if unicodedata.category(c) == "Ll" and
                  c in "éèêëàâîïôûùçœ")
    return "fr" if accents > len(text) / 400 else "en"


PRINTED_PAGE = re.compile(r"^\s*(\d{1,3})\s*$", re.M)


def check_order(pages: list) -> str:
    """Are the files stitched together in the right sequence?

    Every bare number on a page is a candidate for the number the book prints
    there — but so is an exercise number, a year, or a figure caption. Rather
    than trust the first one, every candidate votes for an offset
    (printed - position). If the book is assembled correctly one offset wins
    across the whole book; if the files are out of order, the votes scatter and
    no offset carries a meaningful share.
    """
    # Only pages carrying exactly one bare number are usable. A page with
    # several is a map legend, a statistics table or an exercise list, and
    # guessing which of them is the page number is how a check starts lying.
    # Arabic-Indic digits (٠-٩, ۰-۹) are matched and converted by int() already.
    votes: dict[int, int] = {}
    usable = 0
    for i, page in enumerate(pages, start=1):
        found = [int(m.group(1)) for m in PRINTED_PAGE.finditer(page["text"])]
        if len(found) != 1:
            continue
        n = found[0]
        if abs(n - i) > 40:
            continue
        usable += 1
        votes[n - i] = votes.get(n - i, 0) + 1

    if usable < 10:
        return f"order not verifiable from the text ({usable} unambiguous page numbers)"

    offset = max(votes, key=votes.get)
    share = votes[offset] / usable
    if share >= 0.6:
        return f"order verified: {votes[offset]}/{usable} pages agree on offset {offset:+d}"
    if share >= 0.35:
        return f"order probably right: {votes[offset]}/{usable} agree on offset {offset:+d}"
    return (f"order UNVERIFIED: best offset {offset:+d} carries only {votes[offset]}/{usable}. "
            f"Read the first and last pages of document.md to confirm by eye.")


def import_folder(folder: Path, save_images: bool) -> dict | None:
    files = sorted(folder.glob("*.json"), key=order_key)
    if not files:
        print(f"  {folder.name}: no JSON here (found {len(list(folder.iterdir()))} other files)")
        return None

    name, subject, tracks, expected = BOOKS.get(
        folder.name, (folder.name.replace(" ", "-"), "", "", None)
    )

    digest = hashlib.sha256()
    pages = []
    for path in files:
        digest.update(path.read_bytes())
        data = json.loads(path.read_text(encoding="utf-8"))
        doc_text = data.get("text") or ""
        for pg in data.get("pages") or []:
            text = page_text(doc_text, pg.get("layout"))
            confs = [
                float(t["layout"]["confidence"])
                for t in (pg.get("tokens") or [])
                if isinstance((t.get("layout") or {}).get("confidence"), (int, float))
            ]
            pages.append({
                "text": text.strip(),
                "confidences": confs,
                "image": (pg.get("image") or {}).get("content") if save_images else None,
                "source": path.name,
            })

    sha = digest.hexdigest()
    book_key = f"{name}__{sha[:8]}"
    language = script_of("".join(p["text"] for p in pages[:40]))

    text_dir = CORPUS / "text" / book_key
    meta_dir = CORPUS / "meta" / book_key
    text_dir.mkdir(parents=True, exist_ok=True)
    meta_dir.mkdir(parents=True, exist_ok=True)
    if save_images:
        (CORPUS / "pages" / book_key).mkdir(parents=True, exist_ok=True)

    means, no_conf, blank = [], 0, 0
    for i, page in enumerate(pages, start=1):
        stem = f"{i:03d}"
        (text_dir / f"page-{stem}.md").write_text(page["text"], encoding="utf-8")

        confs = page["confidences"]
        mean = sum(confs) / len(confs) if confs else 1.0
        means.append(mean)
        if not confs:
            no_conf += 1
        if len(page["text"]) < 40:
            blank += 1

        (meta_dir / f"page-{stem}.json").write_text(
            json.dumps({
                "source": {"book": book_key, "folder": folder.name,
                           "file": page["source"], "page": i},
                "reader": {"provider": "google-document-ai"},
                "charCount": len(page["text"]),
                "meanConfidence": round(mean, 4),
                "minConfidence": round(min(confs), 4) if confs else 1.0,
                "lowConfidenceTokenRatio":
                    round(sum(c < LOW_CONFIDENCE for c in confs) / len(confs), 4) if confs else 0.0,
                "hasConfidence": bool(confs),
                "blocks": [],
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        if save_images and page["image"]:
            (CORPUS / "pages" / book_key / f"page-{stem}.jpg").write_bytes(
                base64.b64decode(page["image"])
            )

    (text_dir / "document.md").write_text(
        f"<!-- {folder.name} | document-ai | {sha} -->\n\n"
        + "\n\n---\n\n".join(f"<!-- page {i} -->\n\n{p['text']}\n" for i, p in enumerate(pages, 1)),
        encoding="utf-8",
    )

    verdict = check_order(pages)
    summary = {
        "book": book_key, "folder": folder.name, "sha256": sha,
        "subject": subject, "language": language, "tracks": tracks,
        "reader": "google-document-ai",
        "pagesProcessed": len(pages), "expectedPages": expected,
        "meanConfidence": round(sum(means) / len(means), 4) if means else 0,
        "pagesWithoutConfidence": no_conf, "nearEmptyPages": blank,
        "orderCheck": verdict,
        "files": len(files),
    }
    (meta_dir / "document.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    index_path = CORPUS / "books.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    index[book_key] = summary
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    flag = "" if expected is None or expected == len(pages) else f"  (sheet says {expected})"
    print(f"  {book_key:<34} {len(pages):>4} pages{flag}")
    print(f"      language {language} · confidence {summary['meanConfidence']} · "
          f"{blank} near-empty · {no_conf} pages without confidence")
    print(f"      {verdict}")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--images", action="store_true",
                    help="also write each page's scan (large: roughly 1 MB a page)")
    ap.add_argument("--source", default=str(SOURCE))
    args = ap.parse_args()

    root = Path(args.source)
    if not root.is_dir():
        raise SystemExit(f"Not a folder: {root}")

    # The books are spread over one tree per track (ls-gs-json, lh-json,
    # se-json), with the shared books repeated in each. Collect every folder;
    # identical content hashes to the same book, so repeats import once.
    if any(root.glob("*json*")):
        folders = sorted(d for tree in root.glob("*json*") if tree.is_dir()
                         for d in tree.iterdir() if d.is_dir())
    else:
        folders = sorted(d for d in root.iterdir() if d.is_dir())
    if args.list:
        for d in folders:
            js = list(d.glob("*.json"))
            other = [p for p in d.iterdir() if p.suffix != ".json"]
            known = BOOKS.get(d.name)
            print(f"  {d.name:<20} {len(js):>3} json  {len(other):>3} other   "
                  f"{'-> ' + known[0] if known else 'NOT MAPPED'}")
        return

    if args.folder:
        targets = [d for d in folders if d.name == args.folder] or [root / args.folder]
    elif args.all:
        targets = folders
    else:
        raise SystemExit("give --list, --folder <name> or --all")

    print()
    done, already = [], set()
    for t in targets:
        result = import_folder(t, args.images)
        if not result:
            continue
        if result["book"] in already:
            print(f"      (same book as an earlier folder — written once)")
            continue
        already.add(result["book"])
        done.append(result)
    print()
    print(f"{len(done)} book(s), {sum(d['pagesProcessed'] for d in done)} pages imported")
    print("Next:  npm run corpus:gates -- --book <name>    and    python scripts/corpus/taxonomy.py")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""Transcribes a contents page that Mathpix returned as an image.

    python scripts/corpus/toc-vision.py --book physics-lh-en__3f6585b4
    python scripts/corpus/toc-vision.py --all        # every book that needs it

Some books have their table of contents laid out as a graphic, so Mathpix crops
the whole thing as a figure and the page comes back with no text. Regex cannot
read a picture; this sends that one crop to the vision model and writes
`text/<book>/toc-override.md`, which taxonomy.py reads in place of the page.

One image per book, so the cost is a few cents for the whole corpus.

Needs ANTHROPIC_API_KEY in .env.
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CORPUS = ROOT / "corpus"
TEXT = CORPUS / "text"
FIGURES = CORPUS / "figures"

API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-opus-5"

PROMPT = """You are reading the table of contents of a Lebanese secondary-school textbook.

Transcribe it as plain text, one entry per line, keeping the original language.

- Keep the unit or part headings exactly as printed (Unit 1 Mechanics, Partie 2 ...).
- Write every chapter on its own line as:  <number> <title> ..... <page>
- Use the page number printed in the table. If an entry has no page number, leave it off.
- Do not translate, do not renumber, do not invent entries, do not add commentary.
- If part of the image is unreadable, write [illegible] in place of that entry only.

Output the transcription and nothing else."""


def api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                m = re.match(r'\s*ANTHROPIC_API_KEY\s*=\s*"?([^"\s]+)"?', line)
                if m:
                    key = m.group(1)
                    break
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY is not set (checked the environment and .env).")
    return key


def contents_page(book: str):
    """The page with a contents heading, and the images on it."""
    d = TEXT / book
    pages = {int(re.search(r"(\d+)", f.name).group(1)): f.read_text(encoding="utf-8")
             for f in d.glob("page-*.md")}
    heading = re.compile(r"tables?\s+of\s+contents|tables?\s+des\s+mati|^\s*contents\s*$|sommaire",
                         re.I | re.M)
    for n in sorted(pages):
        if heading.search(pages[n]):
            return n, re.findall(r"!\[\]\((https?://[^)\s]+)\)", pages[n])
    return None, []


def crop_file(book: str, url: str):
    """Maps a Mathpix CDN link to the copy we downloaded.

    The link carries the crop box in its query string and the file encodes the
    same numbers in its name:
        …/<uuid>-005.jpg?height=2776&width=1898&top_left_y=73&top_left_x=73
        <uuid>-005_2776_1898_73_73.jpg
    """
    base = url.split("?")[0].split("/")[-1]
    stem, ext = base.rsplit(".", 1)
    q = dict(re.findall(r"(\w+)=(\d+)", url))
    if not all(k in q for k in ("height", "width", "top_left_y", "top_left_x")):
        return None
    name = f"{stem}_{q['height']}_{q['width']}_{q['top_left_y']}_{q['top_left_x']}.{ext}"

    folder = FIGURES / book
    for candidate in (name, *(p.name for p in folder.glob(f"*{name}") if folder.exists())):
        path = folder / candidate
        if path.exists():
            return path
    return None


def transcribe(path: Path, key: str) -> str:
    media = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    body = {
        "model": MODEL,
        "max_tokens": 4000,
        "thinking": {"type": "disabled"},
        "output_config": {"effort": "low"},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media,
                                             "data": base64.b64encode(path.read_bytes()).decode()}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    }
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        payload = json.loads(r.read())

    if payload.get("stop_reason") == "refusal":
        raise RuntimeError("the model declined to transcribe this image")
    return "".join(b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text")


def run(book: str, key: str) -> bool:
    page, urls = contents_page(book)
    if page is None:
        print(f"  {book}: no contents heading found — nothing to transcribe")
        return False
    if not urls:
        print(f"  {book}: contents page {page} has no image on it")
        return False

    print(f"  {book}: contents page {page}, {len(urls)} image(s)")
    parts = []
    for url in urls:
        path = crop_file(book, url)
        if not path:
            print(f"      no local copy of {url.split('/')[-1][:40]} — skipped")
            continue
        print(f"      transcribing {path.name[:52]} ({path.stat().st_size // 1024} KB)")
        parts.append(transcribe(path, key))

    if not parts:
        print("      nothing transcribed")
        return False

    out = TEXT / book / "toc-override.md"
    out.write_text(f"<!-- transcribed from the image on page {page} -->\n\n" + "\n\n".join(parts),
                   encoding="utf-8")
    print(f"      -> {out}")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--book")
    ap.add_argument("--all", action="store_true", help="every book whose contents page is an image")
    args = ap.parse_args()

    key = api_key()

    if args.book:
        books = [args.book]
    elif args.all:
        # a book needs this when its contents page carries an image and no leaders
        books = []
        for d in sorted(TEXT.iterdir()):
            if not d.is_dir() or (d / "toc-override.md").exists():
                continue
            page, urls = contents_page(d.name)
            if page and urls:
                text = (d / f"page-{page:03d}.md").read_text(encoding="utf-8")
                if len(re.findall(r"\.{2,}\s*\d{1,3}\b", text)) < 4:
                    books.append(d.name)
        print(f"{len(books)} book(s) need an image transcription\n")
    else:
        raise SystemExit("give --book <name> or --all")

    done = sum(1 for b in books if run(b, key))
    print(f"\n{done}/{len(books)} transcribed. Now re-run:  python scripts/corpus/taxonomy.py")


if __name__ == "__main__":
    main()

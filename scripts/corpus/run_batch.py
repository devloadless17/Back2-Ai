# -*- coding: utf-8 -*-
"""Runs every book in catalog.csv through Mathpix, unattended.

    python scripts/corpus/run_batch.py                      # the whole catalog
    python scripts/corpus/run_batch.py --only chimie-fr     # one book
    python scripts/corpus/run_batch.py --pages 1-10         # a test slice of each

The notebook is for looking at one book interactively. This is for leaving
eight of them running.

Safe to re-run: work already done is read from disk, not paid for again. Kill
it and start it again as often as you like.

Needs MATHPIX_APP_ID and MATHPIX_APP_KEY in the environment or in .env.
"""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import time
import zipfile
from pathlib import Path

import requests
from pypdf import PdfReader, PdfWriter

API = "https://api.mathpix.com/v3/pdf"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT_DIR = ROOT / "corpus"
CHUNK_PAGES = 40
PRICE_PER_PAGE = 0.005

OPTIONS = {
    "rm_spaces": True,
    "math_inline_delimiters": ["$", "$"],
    "math_display_delimiters": ["$$", "$$"],
    "enable_tables_fallback": True,
    # Figures are served from a CDN that expires; the zip embeds them. Must be
    # requested at processing time — it cannot be added to a finished job.
    "conversion_formats": {"mmd.zip": True},
}


def load_env() -> dict:
    """Credentials from the environment, falling back to .env."""
    app_id = os.environ.get("MATHPIX_APP_ID")
    app_key = os.environ.get("MATHPIX_APP_KEY")

    env_file = ROOT / ".env"
    if (not app_id or not app_key) and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            m = re.match(r'\s*(MATHPIX_APP_ID|MATHPIX_APP_KEY)\s*=\s*"?([^"\s]+)"?', line)
            if m:
                if m.group(1) == "MATHPIX_APP_ID":
                    app_id = app_id or m.group(2)
                else:
                    app_key = app_key or m.group(2)

    if not app_id or not app_key:
        raise SystemExit(
            "MATHPIX_APP_ID / MATHPIX_APP_KEY not found.\n"
            "Add them to .env or set them in the environment."
        )
    return {"app_id": app_id, "app_key": app_key}


# Filled in by main(). Kept lazy so --help works without credentials, and so
# importing this module never demands secrets.
HEADERS: dict = {}


def with_retry(what, call, tries=4, wait=10):
    """Retries on network failure.

    A dropped TLS connection raises rather than returning a status code, so it
    has to be caught here or one bad moment kills a book.
    """
    for attempt in range(1, tries + 1):
        try:
            return call()
        except requests.exceptions.RequestException as err:
            if attempt == tries:
                raise
            print(f"      {what}: {type(err).__name__} — retry {attempt} in {wait}s")
            time.sleep(wait)
            wait *= 2


def submit(body: bytes, name: str) -> str:
    def call():
        r = requests.post(
            API,
            headers=HEADERS,
            files={"file": (name, body, "application/pdf")},
            data={"options_json": json.dumps(OPTIONS)},
            timeout=(30, 600),
        )
        if r.status_code != 200:
            raise SystemExit(f"Upload failed ({r.status_code}): {r.text}")
        return r.json()["pdf_id"]

    return with_retry("upload", call)


def wait_for(pdf_id: str, label: str) -> None:
    """Polls status, not percent_done — 100% is reported while still assembling."""
    started = time.time()
    while True:
        info = with_retry(
            "status", lambda: requests.get(f"{API}/{pdf_id}", headers=HEADERS, timeout=60).json()
        )
        status = info.get("status", "")
        if status == "completed":
            return
        if status == "error":
            raise RuntimeError(f"Mathpix error on {label}: {info}")
        print(f"\r      {label} {status} … {int(info.get('percent_done', 0))}%   ", end="")
        if time.time() - started > 45 * 60:
            raise RuntimeError(f"Timed out on {label} (pdf_id {pdf_id})")
        time.sleep(5)


def fetch(pdf_id: str, ext: str, tries=8, wait=15, binary=False):
    for attempt in range(1, tries + 1):
        r = with_retry(
            f".{ext}",
            lambda: requests.get(f"{API}/{pdf_id}.{ext}", headers=HEADERS, timeout=600),
        )
        if r.status_code == 200:
            return r.content if binary else r.text
        if attempt < tries:
            time.sleep(wait)
    return None


def subset(raw: bytes, page_indices: list) -> bytes:
    writer = PdfWriter()
    reader = PdfReader(io.BytesIO(raw))
    for i in page_indices:
        writer.add_page(reader.pages[i])
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def already_done(sha256: str, expected_pages: int):
    """Finds an existing transcription of this exact file, whatever it is called.

    A book's identity is its hash, never its folder name. Renaming a book — or
    running it once from the notebook and once from the catalog — must not make
    the pipeline think it is new and pay to read it a second time.
    """
    text_root = OUT_DIR / "text"
    if not text_root.exists():
        return None
    sha8 = sha256[:8]
    for d in text_root.iterdir():
        if not d.is_dir():
            continue
        if not (d.name.endswith(f"__{sha8}") or d.name.startswith(sha256)):
            continue
        pages = len(list(d.glob("page-*.md")))
        if pages >= expected_pages:
            return d, pages
    return None


def run_book(row: dict, pages_spec: str | None, force: bool = False) -> dict:
    path = Path(row["file"])
    if not path.exists():
        print(f"  MISSING FILE: {path}")
        return {"book": row["book_name"], "error": "file not found"}

    raw = path.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()
    total = len(PdfReader(io.BytesIO(raw)).pages)
    book_key = f"{row['book_name']}__{sha256[:8]}"

    if not force and not pages_spec:
        found = already_done(sha256, total)
        if found:
            folder, pages = found
            note = "" if folder.name == book_key else f" (named {folder.name})"
            print(f"  {row['book_name']}: already transcribed, {pages} pages{note} — skipping")
            return {"book": folder.name, "pagesProcessed": pages, "images": 0,
                    "meanConfidence": 0.0, "skipped": True}

    text_dir = OUT_DIR / "text" / book_key
    meta_dir = OUT_DIR / "meta" / book_key
    fig_dir = OUT_DIR / "figures" / book_key
    chunk_dir = meta_dir / "chunks"
    for d in (text_dir, meta_dir, chunk_dir):
        d.mkdir(parents=True, exist_ok=True)

    if pages_spec:
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", pages_spec.strip())
        start, end = int(m.group(1)), int(m.group(2) or m.group(1))
        indices = list(range(start - 1, min(end, total)))
    else:
        indices = list(range(total))

    chunks = [indices[i : i + CHUNK_PAGES] for i in range(0, len(indices), CHUNK_PAGES)]
    print(f"  {book_key}: {len(indices)} pages, {len(chunks)} chunk(s), ~${len(indices)*PRICE_PER_PAGE:.2f}")

    pages, images, mmd_parts = [], [], []

    for n, chunk in enumerate(chunks, start=1):
        first, last = chunk[0] + 1, chunk[-1] + 1
        label = f"chunk {n}/{len(chunks)} p{first}-{last}"
        cached = chunk_dir / f"chunk-{n:03d}.json"

        if cached.exists():
            payload = json.loads(cached.read_text(encoding="utf-8"))
        else:
            body = subset(raw, chunk)
            print(f"    {label}: uploading {len(body)/1024/1024:.1f} MB …")
            pdf_id = submit(body, f"{row['book_name']}-{first}-{last}.pdf")
            wait_for(pdf_id, label)

            lines_raw = fetch(pdf_id, "lines.mmd.json") or fetch(pdf_id, "lines.json")
            if not lines_raw:
                raise RuntimeError(f"No per-line JSON for {label}")

            chunk_images, chunk_mmd = [], ""
            bundle = fetch(pdf_id, "mmd.zip", binary=True)
            if bundle:
                with zipfile.ZipFile(io.BytesIO(bundle)) as z:
                    for name in z.namelist():
                        low = name.lower()
                        if low.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                            fig_dir.mkdir(parents=True, exist_ok=True)
                            out_name = f"p{first:03d}-{Path(name).name}"
                            (fig_dir / out_name).write_bytes(z.read(name))
                            chunk_images.append(out_name)
                        elif low.endswith(".mmd"):
                            chunk_mmd = z.read(name).decode("utf-8")
            else:
                print(f"      {label}: no bundle — figures NOT captured for these pages")

            payload = {
                "pdfId": pdf_id,
                "lines": json.loads(lines_raw),
                "images": chunk_images,
                "mmd": chunk_mmd,
                "firstPage": first,
            }
            cached.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            print(f"\r    {label}: done, {len(chunk_images)} image(s)                    ")

        # Page numbers are relative to the uploaded chunk; shift to real pages.
        offset = payload["firstPage"]
        for i, page in enumerate(payload["lines"].get("pages") or []):
            lines = page.get("lines") or []
            text = "\n".join(str(l.get("text") or l.get("mmd") or "") for l in lines).strip()
            confs = [
                float(l["confidence"]) for l in lines if isinstance(l.get("confidence"), (int, float))
            ]
            pages.append({"number": offset + i, "text": text, "confidences": confs})

        images.extend(payload["images"])
        if payload["mmd"]:
            mmd_parts.append(payload["mmd"])

    means = []
    for page in pages:
        stem = f"{page['number']:03d}"
        (text_dir / f"page-{stem}.md").write_text(page["text"], encoding="utf-8")
        confs = page["confidences"]
        mean = sum(confs) / len(confs) if confs else 1.0
        means.append(mean)
        (meta_dir / f"page-{stem}.json").write_text(
            json.dumps(
                {
                    "source": {"book": book_key, "file": path.name, "sha256": sha256, "page": page["number"]},
                    "reader": {"provider": "mathpix"},
                    "charCount": len(page["text"]),
                    "meanConfidence": round(mean, 4),
                    "minConfidence": round(min(confs), 4) if confs else 1.0,
                    "lowConfidenceTokenRatio": round(sum(c < 0.7 for c in confs) / len(confs), 4)
                    if confs
                    else 0.0,
                    "hasConfidence": bool(confs),
                    "blocks": [],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    if mmd_parts:
        (text_dir / "document.mmd").write_text("\n\n".join(mmd_parts), encoding="utf-8")
    (text_dir / "document.md").write_text(
        f"<!-- {path.name} | {sha256} -->\n\n"
        + "\n\n---\n\n".join(f"<!-- page {p['number']} -->\n\n{p['text']}\n" for p in pages),
        encoding="utf-8",
    )

    summary = {
        "book": book_key,
        "file": path.name,
        "sha256": sha256,
        "subject": row["subject"],
        "language": row["language"],
        "tracks": row["tracks"].split(";"),
        "reader": "mathpix",
        "pdfPageCount": len(indices),
        "pagesProcessed": len(pages),
        "meanConfidence": round(sum(means) / len(means), 4) if means else 0,
        "images": len(images),
        "processedAt": time.strftime("%Y-%m-%d %H:%M"),
    }
    (meta_dir / "document.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    index_path = OUT_DIR / "books.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    index[book_key] = summary
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"    -> {len(pages)} pages, {len(images)} images, confidence {summary['meanConfidence']}")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default=str(HERE / "catalog.csv"))
    parser.add_argument("--only", help="book_name to run on its own")
    parser.add_argument("--pages", help='e.g. "1-10" — a slice of every book, for testing')
    parser.add_argument("--dry-run", action="store_true", help="show the plan and cost, call nothing")
    parser.add_argument("--force", action="store_true", help="re-transcribe even if this file was already done")
    args = parser.parse_args()

    if not args.dry_run:
        HEADERS.update(load_env())

    with open(args.catalog, encoding="utf-8-sig", newline="") as fh:
        rows = [r for r in csv.DictReader(fh) if r.get("file")]
    if args.only:
        rows = [r for r in rows if r["book_name"] == args.only]
        if not rows:
            raise SystemExit(f"No book named {args.only} in the catalog.")

    planned = sum(int(r["pages"]) for r in rows) if not args.pages else None
    print(f"{len(rows)} book(s)" + (f", about {planned} pages, ~${planned*PRICE_PER_PAGE:.2f}" if planned else ""))
    print()

    if args.dry_run:
        total_pages = 0
        for row in rows:
            path = Path(row["file"])
            if not path.exists():
                print(f"  MISSING   {row['book_name']:<22} {path}")
                continue
            raw = path.read_bytes()
            sha = hashlib.sha256(raw).hexdigest()
            real = len(PdfReader(io.BytesIO(raw)).pages)
            n_chunks = (real + CHUNK_PAGES - 1) // CHUNK_PAGES
            flag = "" if str(real) == row["pages"] else f"   (catalog says {row['pages']})"

            found = already_done(sha, real)
            if found and not args.force:
                folder, pages = found
                print(f"  {row['book_name']:<22} {real:>4}p  DONE as {folder.name}")
                continue

            done = len(list((OUT_DIR / "meta" / f"{row['book_name']}__{sha[:8]}" / "chunks").glob("chunk-*.json")))
            total_pages += real
            print(
                f"  {row['book_name']:<22} {real:>4}p  {len(raw)/1024/1024:>5.1f}MB  "
                f"{n_chunks} chunk(s), {done} already done  {sha[:8]}{flag}"
            )
        print()
        print(f"  still to transcribe: {total_pages} pages, about ${total_pages * PRICE_PER_PAGE:.2f}")
        return

    results = []
    for row in rows:
        print(f"[{row['subject']} / {row['language']} / {row['tracks']}]")
        try:
            results.append(run_book(row, args.pages, force=args.force))
        except Exception as err:
            # One bad book must not stop the batch — the rest still run, and
            # re-running picks this one up from its last finished chunk.
            print(f"    FAILED: {type(err).__name__}: {err}")
            results.append({"book": row["book_name"], "error": str(err)})
        print()

    print("=" * 66)
    print(f"{'book':<30}{'pages':>7}{'imgs':>7}{'conf':>8}")
    print("-" * 66)
    for r in results:
        if "error" in r:
            print(f"{r['book']:<30}{'FAILED':>22}")
        else:
            print(f"{r['book']:<30}{r['pagesProcessed']:>7}{r['images']:>7}{r['meanConfidence']:>8.3f}")
    print()
    print("Check each book with:  npm run corpus:gates -- --book <name>")


if __name__ == "__main__":
    main()

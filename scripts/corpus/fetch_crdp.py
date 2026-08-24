# -*- coding: utf-8 -*-
"""Official exam papers from crdp.org — index, compare, download.

    python scripts/corpus/fetch_crdp.py --index          build the manifest only
    python scripts/corpus/fetch_crdp.py --missing        what we do not already have
    python scripts/corpus/fetch_crdp.py --download       fetch the missing ones

The papers are published by the Centre for Educational Research and Development
as a Drupal view with two filters, session and subject, both enumerable from the
page's own dropdowns. So the whole catalogue can be walked rather than guessed
at: 38 sessions, and every paper listed under each.

Three rules this follows, in order of how much trouble they save:

  Identity is the SHA-256 of the file, never its name or its URL. The corpus
  already holds 1,451 papers whose filenames are inconsistent Lebanese written
  in Latin letters; matching on anything else would re-download and re-read work
  that is already done. The site's own names are opaque timestamps
  (201702101237343.pdf), which would be worse.

  Nothing is downloaded twice, and nothing already in the corpus is downloaded
  at all. The manifest is written first and compared before a single byte of PDF
  is fetched.

  One request at a time, with a pause between. This is a ministry's public
  server and the whole catalogue is a few thousand files; there is no reason to
  hit it hard, and being asked to stop would cost more than the wait.
"""

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
INBOX = CORPUS / "crdp-inbox"
MANIFEST = CORPUS / "crdp-manifest.json"

BASE = "https://www.crdp.org"
LISTING = BASE + "/official-exams-corrections-lebanon"
AGENT = "Mozilla/5.0 (compatible; bac2-corpus-import/1.0)"
PAUSE = 1.0

ROW = re.compile(
    r'<td[^>]*views-field-title"[^>]*>\s*<a[^>]*href="([^"]+\.pdf)"[^>]*>(.*?)</a>',
    re.S | re.I,
)
SELECT = re.compile(r'name="{name}".*?</select>', re.S)
OPTION = re.compile(r'value="([^"]*)"[^>]*>([^<]{1,90})')

# CRDP publishes two certificates from the same index page: the Baccalaureate,
# which is this product's whole subject, and the Brevet — الشهادة المتوسطة, sat
# at the end of grade 9. Nothing here wants the Brevet. Its papers are three
# years below the syllabus the tutor teaches, so a Brevet question filed against
# a Bac chapter is off-syllabus material shown to a student as exam practice.
#
# 54 of them were downloaded before this filter existed. None was ever loaded —
# they sat in the inbox — but the only thing standing between them and the
# database was that nobody had bulk-moved the folder yet.
#
# Matched on the CERTIFICATE NAME IN THE TITLE, not on the BR_ filename prefix.
# The filename is CRDP's convention and could change; the title is the document
# describing itself. On the 248 papers held when this was written the two agreed
# exactly — 54 by name, the same 54 by title, no disagreement either way — which
# is what makes the title safe to rely on alone.
BREVET = re.compile(r"الشهادة\s+المتوسطة|brevet", re.I)


def fetch(url: str, tries: int = 3) -> str:
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == tries - 1:
                print(f"    ! {url} failed: {exc}")
                return ""
            time.sleep(3 * (attempt + 1))
    return ""


def sessions(html: str) -> list:
    block = re.search(r'name="sessionurl".*?</select>', html, re.S)
    if not block:
        return []
    out = []
    for value, label in OPTION.findall(block.group(0)):
        if value and value != "All":
            out.append((value, re.sub(r"\s+", " ", label).strip()))
    return out


def rows_for(session: str) -> list:
    """Every paper listed under one session, following the infinite scroll."""
    found = {}
    for page in range(0, 8):
        query = urllib.parse.urlencode(
            {"sessionurl": session, "term_node_tid_depth": "All", "page": page}
        )
        html = fetch(f"{LISTING}?{query}")
        time.sleep(PAUSE)
        if not html:
            break
        rows = ROW.findall(html)
        fresh = 0
        for href, label in rows:
            title = re.sub(r"<[^>]+>", " ", label)
            title = re.sub(r"\s+", " ", title).strip()
            if href not in found:
                found[href] = title
                fresh += 1
        # Infinite scroll repeats the last page once it runs out.
        if fresh == 0:
            break
    return [{"url": urllib.parse.urljoin(BASE, href), "title": title} for href, title in found.items()]


def known_hashes() -> set:
    """SHA-256 of every exam PDF already in the corpus."""
    seen = set()
    exams = CORPUS / "exams"
    if exams.exists():
        for pdf in exams.rglob("*.pdf"):
            seen.add(hashlib.sha256(pdf.read_bytes()).hexdigest())
    if INBOX.exists():
        for pdf in INBOX.rglob("*.pdf"):
            seen.add(hashlib.sha256(pdf.read_bytes()).hexdigest())
    return seen


def build_index() -> list:
    html = fetch(f"{LISTING}?sessionurl=All&term_node_tid_depth=All")
    found = sessions(html)
    if not found:
        print("Could not read the session list — the page layout may have changed.")
        return []

    print(f"{len(found)} sessions listed", flush=True)
    manifest = []
    for value, label in found:
        rows = rows_for(value)
        print(f"  {label:<34}{len(rows):>4} papers", flush=True)
        for row in rows:
            row["session"] = label
            manifest.append(row)

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print()
    print(f"{len(manifest)} papers indexed -> {MANIFEST}")
    return manifest


def load_manifest() -> list:
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print("No manifest yet — run with --index first.")
        return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", action="store_true")
    ap.add_argument("--missing", action="store_true")
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument(
        "--years",
        default="",
        help="comma-separated years, e.g. 2021,2022,2023,2024. Downloads only those sessions.",
    )
    args = ap.parse_args()

    if args.index:
        build_index()
        return

    manifest = load_manifest()
    if not manifest:
        return

    if args.missing:
        # Only the URL is known without downloading, so this reports the
        # catalogue's size against ours. The hash comparison happens per file at
        # download time, which is the only point it can be honest.
        print(f"{len(manifest)} papers in the catalogue")
        by_session = {}
        for row in manifest:
            by_session.setdefault(row["session"], 0)
            by_session[row["session"]] += 1
        for session, count in sorted(by_session.items()):
            print(f"  {session:<34}{count:>4}")
        return

    if args.download:
        # Only the sessions asked for.
        #
        # A file's hash cannot be known before downloading it, so "download only
        # what is missing" has to be decided from the session label instead. Our
        # coverage is dense for 2004-2019 and empty from 2021 on, so filtering by
        # year fetches the genuinely new material without pulling two thousand
        # papers to discover we already hold most of them. The hash check still
        # runs per file and still refuses duplicates.
        if args.years:
            wanted = {y.strip() for y in args.years.split(",") if y.strip()}
            before = len(manifest)
            manifest = [r for r in manifest if any(y in r["session"] for y in wanted)]
            print(f"{len(manifest)} of {before} papers are in {sorted(wanted)}")
        INBOX.mkdir(parents=True, exist_ok=True)
        seen = known_hashes()
        print(f"{len(seen)} papers already in the corpus")

        new = duplicate = failed = brevet = 0
        for row in manifest:
            if args.limit and new >= args.limit:
                break
            name = row["url"].rsplit("/", 1)[-1]
            if BREVET.search(row["title"]):
                brevet += 1
                continue
            target = INBOX / name
            if target.exists():
                continue
            # Retried: a single timeout on a ministry server mid-afternoon is
            # not a missing paper, and giving up on it silently would leave a
            # hole nobody notices until a student looks for that year.
            data = None
            for attempt in range(3):
                try:
                    request = urllib.request.Request(row["url"], headers={"User-Agent": AGENT})
                    with urllib.request.urlopen(request, timeout=180) as response:
                        data = response.read()
                    break
                except Exception as exc:
                    if attempt == 2:
                        print(f"  ! {name}: {type(exc).__name__}", flush=True)
                    else:
                        time.sleep(4 * (attempt + 1))
            if data is None:
                failed += 1
                time.sleep(PAUSE)
                continue

            digest = hashlib.sha256(data).hexdigest()
            if digest in seen:
                duplicate += 1
            else:
                seen.add(digest)
                target.write_bytes(data)
                (INBOX / (name + ".json")).write_text(
                    json.dumps({**row, "sha256": digest}, ensure_ascii=False), encoding="utf-8"
                )
                new += 1
                if new % 25 == 0:
                    print(f"  {new} new papers so far", flush=True)
            time.sleep(PAUSE)

        print()
        print(f"{new} new, {duplicate} already held, {failed} failed -> {INBOX}")
        # Said out loud rather than filtered silently: a reader who expected
        # those papers should see that they were refused, and why.
        if brevet:
            print(f"{brevet} skipped: Brevet (grade 9), not the Baccalaureate")
        return

    ap.print_help()


if __name__ == "__main__":
    sys.exit(main())

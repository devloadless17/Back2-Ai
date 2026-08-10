# -*- coding: utf-8 -*-
"""Turns the parsed taxonomy into a page a person can check.

    python scripts/corpus/review-taxonomy.py

Writes corpus/taxonomy/review.html — every book, every chapter, with the pages
that were guessed rather than found marked, so a reviewer knows where to look
first. Open it in a browser next to the PDFs.
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TAX = ROOT / "corpus" / "taxonomy"
CATALOG = ROOT / "scripts" / "corpus" / "catalog.csv"

meta = {}
if CATALOG.exists():
    with CATALOG.open(encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            meta[row["folder"]] = row

books = []
for path in sorted(TAX.glob("*.json")):
    data = json.loads(path.read_text(encoding="utf-8"))
    if not data.get("chapters"):
        books.append((data, meta.get(data["book"])))
        continue
    books.append((data, meta.get(data["book"])))

# one entry per unique book: skip the duplicate folders
seen, unique = set(), []
for data, m in books:
    key = m["sha8"] if m else data["book"]
    if key in seen:
        continue
    seen.add(key)
    unique.append((data, m))

rows = []
for data, m in sorted(unique, key=lambda b: (b[1]["subject"] if b[1] else "zz",
                                             b[1]["tracks"] if b[1] else "",
                                             b[1]["language"] if b[1] else "")):
    rows.append((data, m))

total = sum(len(d["chapters"]) for d, _ in rows)
flagged = sum(1 for d, _ in rows for c in d["chapters"] if c.get("inferred") or not c.get("pdfPage"))

parts = []
for data, m in rows:
    title = m["book_name"] if m else data["book"]
    sub = f"{m['subject']} · {m['language'].upper()} · {m['tracks'].replace(';', ' + ')} · {m['pages']} pages" if m else data["book"]
    err = data.get("error")

    if err:
        parts.append(f'<section><h2>{title}</h2><p class="sub">{sub}</p>'
                     f'<p class="err">NOT PARSED — {err}</p></section>')
        continue

    body = []
    unit = object()
    for c in data["chapters"]:
        if c.get("unit") != unit:
            unit = c.get("unit")
            if unit:
                body.append(f'<tr class="unit"><td colspan="4">{unit}</td></tr>')
        page = c.get("pdfPage")
        end = c.get("pdfPageEnd")
        span = f"{page}–{end}" if page and end else (str(page) if page else "—")
        cls = "guess" if c.get("inferred") else ("bad" if not page else "")
        note = "page guessed" if c.get("inferred") else ("no page" if not page else "")
        body.append(
            f'<tr class="{cls}"><td class="n">{c["index"]}</td><td>{c["title"]}</td>'
            f'<td class="p">{span}</td><td class="note">{note}</td></tr>'
        )

    parts.append(
        f'<section><h2>{title}</h2><p class="sub">{sub} · '
        f'{len(data["chapters"])} chapters · offset {data.get("pageOffset")}</p>'
        f'<table><thead><tr><th>#</th><th>chapter</th><th>pdf pages</th><th></th></tr></thead>'
        f'<tbody>{"".join(body)}</tbody></table></section>'
    )

html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Chapter taxonomy — review</title>
<style>
 body{{font-family:system-ui,Segoe UI,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222}}
 h1{{margin-bottom:.2rem}} .lede{{color:#666;margin-top:0}}
 section{{margin:2.5rem 0}} h2{{margin-bottom:.1rem;font-size:1.15rem;color:#1f3b57}}
 .sub{{color:#777;font-size:.85rem;margin:.1rem 0 .6rem}}
 table{{border-collapse:collapse;width:100%;font-size:.9rem}}
 th{{text-align:left;background:#1f3b57;color:#fff;padding:.35rem .5rem;font-weight:600}}
 td{{border-bottom:1px solid #eee;padding:.3rem .5rem;vertical-align:top}}
 td.n{{width:2.5rem;color:#888}} td.p{{width:6rem;white-space:nowrap;color:#555}}
 td.note{{width:7rem;color:#b26a00;font-size:.8rem}}
 tr.unit td{{background:#eef2f6;font-weight:600;color:#1f3b57}}
 tr.guess td.p{{background:#fff6e5}} tr.bad td{{background:#fdeeee}}
 .err{{color:#b00020;font-weight:600}}
 .key{{background:#f7f7f7;padding:.6rem .9rem;border-radius:6px;font-size:.85rem;color:#555}}
</style></head><body>
<h1>Chapter taxonomy — review</h1>
<p class="lede">{total} chapters across {len(rows)} books · {flagged} need a look</p>
<p class="key"><b>What to check:</b> chapter titles read like the book ·
nothing missing or duplicated versus the printed contents ·
open the first page of each <span style="background:#fff6e5">shaded</span> span and confirm the chapter starts there.
Shaded = the page was calculated, not found. Red = no page at all.</p>
{"".join(parts)}
</body></html>"""

out = TAX / "review.html"
out.write_text(html, encoding="utf-8")
print(f"{total} chapters, {len(rows)} unique books, {flagged} flagged")
print(f"written: {out}")

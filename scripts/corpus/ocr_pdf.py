# -*- coding: utf-8 -*-
"""Reads a PDF whose own text layer cannot be trusted, using a vision model.

    python scripts/corpus/ocr_pdf.py --pdf "corpus/tarikh.pdf" --name history-all --estimate
    python scripts/corpus/ocr_pdf.py --pdf "corpus/tarikh.pdf" --name history-all
    python scripts/corpus/ocr_pdf.py --pdf "corpus/tarikh.pdf" --name history-all --pages 1-5

Most books in this corpus were read by Google Document AI and arrived as JSON.
This is for the ones that did not, and specifically for a PDF that *has* a text
layer which is quietly wrong — the history book maps ث to ا and ش to a space, so
`مباشراً` extracts as `مبا ييرار`. Text like that is worse than no text: it looks
readable, it embeds without complaint, and it retrieves nonsense.

Costs money, so:

  * `--estimate` prints the bill and writes nothing.
  * every page is written as it is read, and a page already on disk is skipped,
    so an interrupted run resumes instead of paying twice.
  * the model is told to transcribe and nothing else. A vision model asked to
    read a page will happily describe it instead, and a page of description
    reads plausibly while being entirely invented. Any page that comes back
    with too little Arabic for its size is flagged rather than saved silently.
"""

import argparse
import base64
import http.client
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT = ROOT / "corpus" / "text"

OPENAI_API = "https://api.openai.com/v1/chat/completions"
ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
SCALE = 2  # ~150 dpi; enough for printed Arabic without inflating the image bill

SYSTEM = (
    "You transcribe scanned textbook pages. Reproduce the page's text exactly as printed, "
    "in its own language and reading order. Keep headings on their own lines. "
    "Do not translate, summarise, explain, or describe the page. Do not add commentary, "
    "notes or markdown fences. If the page is blank, reply with exactly: [blank page]"
)

ARABIC = re.compile(r"[؀-ۿ]")


def is_claude(model: str) -> bool:
    return model.startswith("claude")


def api_key(model: str) -> str:
    """The key for whichever provider the model belongs to."""
    name = "ANTHROPIC_API_KEY" if is_claude(model) else "OPENAI_API_KEY"
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(name):
            value = line.split("=", 1)[1].strip().strip('"')
            if value:
                return value
    raise SystemExit(f"{name} not found in .env")


def render(pdf, index: int) -> bytes:
    image = pdf[index].render(scale=SCALE).to_pil()
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def read_page(key: str, model: str, jpeg: bytes) -> tuple:
    """One page, from whichever provider the model names.

    Claude is three times cheaper than GPT for this at the same page rates
    (in $2/M vs $5/M, out $10/M vs $30/M on the Sonnet tier), and this is 576
    pages of scanned Arabic, so the difference is the difference between a
    decision and a formality. The two APIs disagree about where the system
    prompt goes, how an image is attached and what the response is called;
    nothing else here changes.
    """
    encoded = base64.b64encode(jpeg).decode()

    if is_claude(model):
        url = ANTHROPIC_API
        body = {
            "model": model,
            "max_tokens": 4000,
            "system": SYSTEM,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/jpeg", "data": encoded},
                        },
                        {"type": "text", "text": "Transcribe this page."},
                    ],
                }
            ],
        }
        headers = {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }
    else:
        url = OPENAI_API
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Transcribe this page."},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/jpeg;base64," + encoded,
                                "detail": "high",
                            },
                        },
                    ],
                },
            ],
            # A reasoning model spends its hidden thinking out of this same
            # budget. At 4000 a dense marking-scheme page came back EMPTY: the
            # whole allowance went on thinking and no text was ever written.
            "max_completion_tokens": 16000,
        }
        # Only reasoning models take this; gpt-4.1 and gpt-4o reject it.
        if model.startswith(("gpt-5", "o")):
            body["reasoning_effort"] = "low"
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.load(response)
            if is_claude(model):
                usage = payload.get("usage", {})
                text = "".join(
                    block.get("text", "") for block in payload.get("content", [])
                    if block.get("type") == "text"
                )
                return text, {
                    "prompt_tokens": usage.get("input_tokens", 0),
                    "completion_tokens": usage.get("output_tokens", 0),
                }
            usage = payload.get("usage", {})
            return payload["choices"][0]["message"]["content"] or "", usage
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(4 * (attempt + 1))
                continue
            raise SystemExit(f"page failed ({e.code}): {e.read().decode()[:200]}")
        except (OSError, http.client.HTTPException):
            # OSError covers timeouts, URLError and a dropped connection
            # (RemoteDisconnected), which is what ended a 1,651-page run five
            # pages short.
            # A slow response on a dense page is not a bad page. Without this a
            # single timeout killed the whole run mid-paper.
            if attempt < 3:
                time.sleep(4 * (attempt + 1))
                continue
            raise
    return "", {}


def parse_range(spec: str, total: int) -> list:
    if not spec:
        return list(range(total))
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a) - 1, int(b)))
        else:
            out.append(int(part) - 1)
    return [n for n in out if 0 <= n < total]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--name", required=True, help="folder name, without the hash suffix")
    ap.add_argument("--pages", default="")
    ap.add_argument("--model", default="gpt-5.5")
    ap.add_argument("--estimate", action="store_true")
    args = ap.parse_args()

    import hashlib

    import pypdfium2 as pdfium

    source = ROOT / args.pdf if not Path(args.pdf).is_absolute() else Path(args.pdf)
    if not source.exists():
        raise SystemExit(f"not found: {source}")

    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    folder = TEXT / f"{args.name}__{sha[:8]}"
    pdf = pdfium.PdfDocument(str(source))
    wanted = parse_range(args.pages, len(pdf))

    todo = [n for n in wanted if not (folder / f"page-{n + 1:03d}.md").exists()]

    if args.estimate:
        # Measured on this corpus: a rendered page is ~1.1k image tokens at high
        # detail, and a dense Arabic page comes back around 1.5k output tokens.
        print(f"{len(pdf)} pages, {len(todo)} still to read")
        print(f"  ~{len(todo) * 1.1:.0f}k input tokens, ~{len(todo) * 1.5:.0f}k output tokens")
        print("  Check your provider's current per-token price before running.")
        return

    folder.mkdir(parents=True, exist_ok=True)
    key = api_key(args.model)
    total_in = total_out = 0
    thin = []
    empty = []

    for n in todo:
        jpeg = render(pdf, n)
        text, usage = read_page(key, args.model, jpeg)
        total_in += usage.get("prompt_tokens", 0)
        total_out += usage.get("completion_tokens", 0)

        text = re.sub(r"^```[a-z]*\n|\n```$", "", text.strip())
        arabic = len(ARABIC.findall(text))

        # Nothing back is a failure, not a blank page — a blank page says
        # "[blank page]". Not written, so the next run retries it instead of
        # the resume check treating an empty file as done.
        if not text:
            empty.append(n + 1)
            print(f"  page {n + 1:>3}  EMPTY — not saved, re-run to retry")
            continue

        if text != "[blank page]" and arabic < 40:
            thin.append(n + 1)

        (folder / f"page-{n + 1:03d}.md").write_text(text + "\n", encoding="utf-8")
        print(f"  page {n + 1:>3}  {len(text):>6} chars  {arabic:>5} arabic")

    print()
    print(f"{len(todo)} page(s) read into {folder.name}")
    print(f"  tokens: {total_in} in, {total_out} out")
    if thin:
        print(f"  CHECK these pages by eye — very little Arabic came back: {thin}")
    if empty:
        print(f"  FAILED — nothing came back, re-run to retry: {empty}")


if __name__ == "__main__":
    sys.exit(main())

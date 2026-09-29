# -*- coding: utf-8 -*-
"""Which tracks sat the same history paper, from the PDFs themselves.

    python scripts/corpus/history_twins.py  ->  scripts/corpus/history-twins.json

load-history-exams-manual.ts --fill-empty creates a track's history exam only
when that track's paper is byte-identical to one the transcription is known to
cover: a pre-CRDP paper under lh/ (the transcriptions were typed from those),
or another track's copy whose exam already carries the transcribed questions.
Production has no PDFs, so the comparison is made here and shipped as data.
"""
import hashlib, json, re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXAMS = ROOT / "corpus" / "exams"
HISTORY = re.compile(r"(tarekh|terekh|tarikh|histo|hsitory)", re.I)
# Adapted editions are other papers, not copies of the ordinary one.
ACCOMMODATION = re.compile(r"(ehte[uy]ejet|ehtiyejet|makfu|makfou|makfo|mokhtas|mu5tas)", re.I)
SESSION = re.compile(r"^(20\d\d) ([12])$")

by_key = defaultdict(dict)  # "2019-1" -> track -> set of sha256
lh_source = defaultdict(set)  # "2019-1" -> sha256 of pre-CRDP lh papers
for pdf in sorted(EXAMS.rglob("*.pdf")):
    track, folder = pdf.relative_to(EXAMS).parts[:2]
    m = SESSION.match(folder)
    if not m or not HISTORY.search(pdf.name) or ACCOMMODATION.search(pdf.name):
        continue
    key = f"{m.group(1)}-{m.group(2)}"
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    by_key[key].setdefault(track, set()).add(sha)
    if track == "lh" and "crdp" not in pdf.name:
        lh_source[key].add(sha)

out = {}
for key, tracks in sorted(by_key.items()):
    for track, shas in sorted(tracks.items()):
        twins = sorted(t for t, s in tracks.items() if t != track and s & shas)
        out[f"{track.upper()} {key}"] = {"lhSource": bool(shas & lh_source[key]), "twins": [t.upper() for t in twins]}
path = ROOT / "scripts" / "corpus" / "history-twins.json"
path.write_text(json.dumps(out, indent=1) + "\n", "utf-8")
print(f"{len(out)} track-sessions -> {path.name}")

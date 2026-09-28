"""Trim the exam's header box off four geography map crops.

    python scripts/corpus/geo_maps_trim.py

Mathpix cut these four maps together with the page's header box ("مسابقة في
مادة الجغرافيا / الاسم / الرقم") and, on one, an instruction line. The map sits
in its own frame, so the cut is at the frame's top border: the LAST long
horizontal line (>= 80% of the width dark) in the top third of the image.
Writes corpus/geo-maps/trimmed/<crop>.jpg; the original crops are left as they
are, because backfill-visuals checks their bytes against C2.
"""
import json, os
from PIL import Image
import numpy as np

CROPS = {
    '6ad8f0f3-23c7-45e3-aaee-b26bf2aed3e3': 'corpus/text/0c835bc2cbaa8ed38781f39722a160438b090adaa6c8d90f6a2c592318a8b97d/figures/fd57bf115714a0a9.jpg',
    '927ca4ea-4365-48d6-b884-36b8c3d48aa5': 'corpus/text/8ad1a97db1e205ff7981ba714ea0cad6abc6979d4854ae37638e33140fca580c/figures/71b90388f65a9f85.jpg',
    '92e000de-99e5-4387-92cd-cd51e6f76832': 'corpus/text/b9259d23a52ad27de88ed394563e5cc62111ce7b070db5328b89ddcdc0365218/figures/ffe7995f81e2c335.jpg',
    '5254ac81-b2a3-47fd-ac7e-6e9fe88cdf46': 'corpus/text/6f15e7e7b698fe7100084670f741f9ff5bce405872baf084af82f0deb5c35608/figures/698cdf22f79a6517.jpg',
}
out = {}
for occ, path in CROPS.items():
    img = Image.open(path).convert('RGB')
    g = np.asarray(img.convert('L'))
    h, w = g.shape
    dark = (g < 110).mean(axis=1)
    lines = [y for y in range(int(h * 0.35)) if dark[y] >= 0.8]
    # Adjacent rows of one thick line: take the first row of the last run.
    runs = [y for i, y in enumerate(lines) if i == 0 or y != lines[i - 1] + 1]
    if len(runs) < 2:
        print('no frame line found, skipped', path); continue
    cut = max(runs[-1] - 2, 0)
    dst = f"corpus/geo-maps/trimmed/{os.path.basename(path)}"
    img.crop((0, cut, w, h)).save(dst, quality=92)
    out[occ] = {'src': path, 'dst': dst, 'cut': cut, 'height': h, 'lines': runs}
    print(os.path.basename(path), 'cut at', cut, 'of', h, 'lines', runs)
json.dump(out, open('corpus/geo-maps/trimmed/trim.json', 'w'), indent=1)

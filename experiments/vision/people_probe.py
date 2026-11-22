"""Scores a person detector on people_probe.mjs frames: per ground-truth person, found or not, by lighting.

Ground-truth boxes include what's hidden (legs below the table tops), so a detection counts for a person when at
least half of it lies inside the person's box. Usage: people_probe.py <dir> [weights] [conf]
(the person class is the model's class named "person": 0 for COCO, 2 for the student)
"""
import collections
import json
import sys
from pathlib import Path

from ultralytics import YOLO

d = Path(sys.argv[1])
weights = sys.argv[2] if len(sys.argv) > 2 else "/Users/jimmie/Projects/vms/analysis/object_tracks/weights/yolo26s.pt"
conf = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
model = YOLO(weights)
person = [k for k, v in model.names.items() if v == "person"]
index = json.loads((d / "index.json").read_text())
found, total, extra = collections.Counter(), collections.Counter(), collections.Counter()
for item in index:
    r = model.predict(str(d / item["file"]), classes=person, conf=conf, verbose=False, device="cpu")[0]
    h, w = r.orig_shape
    dets = [(x0 / w, y0 / h, x1 / w, y1 / h) for x0, y0, x1, y1 in r.boxes.xyxy.tolist()]
    used = set()
    key = (item["lighting"], item["cam"])
    for p in item["people"]:
        x, y, bw, bh = p["box"]
        total[key] += 1
        for i, (a, b, c, e) in enumerate(dets):
            inter = max(0, min(c, x + bw) - max(a, x)) * max(0, min(e, y + bh) - max(b, y))
            if inter >= 0.5 * (c - a) * (e - b):
                found[key] += 1
                used.add(i)
                break
    inside = lambda d: any(max(0, min(d[2], p["box"][0] + p["box"][2]) - max(d[0], p["box"][0])) * max(0, min(d[3], p["box"][1] + p["box"][3]) - max(d[1], p["box"][1])) >= 0.5 * (d[2] - d[0]) * (d[3] - d[1]) for p in item["people"])
    extra[key] += sum(1 for i, d in enumerate(dets) if i not in used and not inside(d))
print(f"{weights.split('/')[-1]} conf {conf}: people found / in view (person boxes not on any person)")
for key in sorted(total):
    print(f"  {key[0]:8s} {key[1]:10s} {found[key]:4d} / {total[key]:4d} ({found[key] / total[key] * 100:3.0f} %)  extra {extra[key]}")
n, t = sum(found.values()), sum(total.values())
print(f"  all                 {n:4d} / {t:4d} ({n / t * 100:3.0f} %)  extra {sum(extra.values())}")

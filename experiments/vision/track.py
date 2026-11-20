"""Run a detector + tracker on a recording and summarise what it found.

usage: uv run python track.py <model> <video> [--classes "pen,robot arm"] [--seconds 30] [--conf 0.25]
Writes an annotated video to out/<model>/<camera>.mp4 and prints per-class detection/track counts.
"""
import argparse
import collections
import pathlib
import time

import cv2
from ultralytics import YOLO

p = argparse.ArgumentParser()
p.add_argument("model")
p.add_argument("video")
p.add_argument("--classes", help="comma-separated text prompts (open-vocabulary models only)")
p.add_argument("--seconds", type=float, default=30)
p.add_argument("--conf", type=float, default=0.25)
p.add_argument("--tracker", default="bytetrack.yaml")
a = p.parse_args()

model = YOLO(a.model)
if a.classes:
    names = [c.strip() for c in a.classes.split(",")]
    model.set_classes(names)

video = pathlib.Path(a.video)
cap = cv2.VideoCapture(str(video))
fps = cap.get(cv2.CAP_PROP_FPS) or 25
w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
out_dir = pathlib.Path("out") / pathlib.Path(a.model).stem
out_dir.mkdir(parents=True, exist_ok=True)
writer = cv2.VideoWriter(str(out_dir / f"{video.stem}.mp4"), cv2.VideoWriter_fourcc(*"avc1"), fps, (w, h))

dets = collections.Counter()
tracks = collections.defaultdict(set)
track_len = collections.Counter()
frames, t0 = 0, time.time()
while frames < a.seconds * fps:
    ok, frame = cap.read()
    if not ok:
        break
    r = model.track(frame, persist=True, conf=a.conf, tracker=a.tracker, device="mps", verbose=False)[0]
    for box in r.boxes:
        name = r.names[int(box.cls)]
        dets[name] += 1
        if box.id is not None:
            tid = int(box.id)
            tracks[name].add(tid)
            track_len[tid] += 1
    writer.write(r.plot())
    frames += 1
writer.release()

dt = time.time() - t0
print(f"{video.stem}: {frames} frames, {frames / dt:.1f} fps")
for name, n in dets.most_common():
    ids = tracks[name]
    mean_len = sum(track_len[i] for i in ids) / len(ids) if ids else 0
    print(f"  {name:20s} {n / frames:5.2f}/frame  {len(ids):4d} tracks  mean track {mean_len / fps:5.1f}s")

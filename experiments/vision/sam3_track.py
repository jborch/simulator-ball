"""SAM 3 video tracking with text prompts (its own detector + memory tracker, no ByteTrack).

usage: uv run python sam3_track.py [--start 80] [--seconds 40] cam [cam ...]
"""
import argparse, collections, pathlib, time
import cv2
from ultralytics.models.sam import SAM3VideoSemanticPredictor
from vp_track import NAMES, annotate

PROMPTS = ["yellow platform", "tube"]  # -> mover, pen

p = argparse.ArgumentParser()
p.add_argument("cams", nargs="+")
p.add_argument("--recordings", default="recordings/20261118-141154")
p.add_argument("--start", type=float, default=80)
p.add_argument("--seconds", type=float, default=40)
p.add_argument("--conf", type=float, default=0.5)
a = p.parse_args()
out = pathlib.Path("out/sam3"); out.mkdir(parents=True, exist_ok=True)

for cam in a.cams:
    cap = cv2.VideoCapture(f"{a.recordings}/{cam}.mp4"); fps = cap.get(cv2.CAP_PROP_FPS) or 25
    cap.set(cv2.CAP_PROP_POS_MSEC, a.start * 1000)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    clip = out / f"{cam}-clip.mp4"
    wr = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    for _ in range(int(a.seconds * fps)):
        ok, f = cap.read()
        if not ok: break
        wr.write(f)
    wr.release()

    pred = SAM3VideoSemanticPredictor(overrides=dict(conf=a.conf, task="segment", mode="predict", model="sam3.pt", half=True, save=False, verbose=False))
    writer = cv2.VideoWriter(str(out / f"{cam}.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    trails = collections.defaultdict(lambda: collections.deque(maxlen=30))
    track_cls, track_frames, dets, ms = {}, collections.Counter(), collections.Counter(), []
    n, t = 0, time.time()
    for r in pred(source=str(clip), text=PROMPTS, stream=True):
        ms.append((time.time() - t) * 1000)
        boxes = []
        for b in r.boxes:
            x1, y1, x2, y2 = map(int, b.xyxy[0].tolist()); cls = int(b.cls); tid = int(b.id) if b.id is not None else None
            dets[cls] += 1
            if tid is not None:
                trails[tid].append(((x1 + x2) // 2, (y1 + y2) // 2)); track_cls[tid] = cls; track_frames[tid] += 1
            boxes.append(((x1, y1, x2, y2), cls, tid, float(b.conf)))
        frame = r.orig_img.copy()
        annotate(frame, boxes, trails, f"{cam}  SAM 3 (text: {PROMPTS[0]!r}, {PROMPTS[1]!r})  {ms[-1]:.0f} ms/frame")
        writer.write(frame); n += 1; t = time.time()
    writer.release(); clip.unlink()
    ms.sort()
    print(f"{cam} ({n} frames) SAM 3  {ms[len(ms)//2]:.0f} ms/frame (median)  " + "   ".join(
        f"{NAMES[c]} {dets[c]/n:4.2f}/frame {sum(1 for v in track_cls.values() if v == c):3d} tracks "
        f"{(sum(track_frames[i] for i, v in track_cls.items() if v == c) / max(1, sum(1 for v in track_cls.values() if v == c)) / fps):4.1f}s" for c in (0, 1)), flush=True)

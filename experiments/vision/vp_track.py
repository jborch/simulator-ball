"""YOLOE-26 + visual prompts + tracker → annotated videos.

A user draws a few example boxes per class on reference frames (here: REFS). Their visual
embeddings are kept as prompts (several per class), which YOLOE then detects in every frame; a
multi-object tracker (ByteTrack / BoT-SORT) links detections into tracks.

usage: uv run python vp_track.py [--seconds 60] [--model yoloe-26l-seg.pt] [--tracker bytetrack.yaml] cam [cam ...]
"""
import argparse
import collections
import pathlib
import time

import cv2
import numpy as np
import torch
from ultralytics import YOLO
from ultralytics.models.yolo.yoloe import YOLOEVPSegPredictor

NAMES = ["mover", "pen"]
MOVER, PEN = 0, 1
# Example boxes (x1, y1, x2, y2) drawn on reference frames of four cameras.
REFS = [
    ("out/frames/cartridge.png", [([45, 565, 358, 680], MOVER), ([427, 565, 662, 680], MOVER),
                                  ([188, 368, 252, 600], PEN), ([525, 368, 580, 612], PEN)]),
    ("out/frames/infeed.png", [([102, 508, 300, 577], MOVER), ([300, 508, 498, 577], MOVER),
                               ([395, 375, 422, 515], PEN)]),
    ("out/frames/springbase.png", [([433, 483, 580, 535], MOVER), ([793, 483, 950, 535], MOVER),
                                   ([495, 373, 530, 495], PEN), ([850, 373, 890, 495], PEN)]),
    ("out/frames/housing-60.png", [([97, 558, 387, 660], MOVER), ([622, 558, 850, 660], MOVER),
                                   ([697, 195, 752, 585], PEN)]),
]
# H.264 where OpenCV has an encoder for it (macOS); pip OpenCV on Linux only has MPEG-4.
FOURCC = cv2.VideoWriter_fourcc(*("avc1" if __import__("sys").platform == "darwin" else "mp4v"))
COLORS = {MOVER: (255, 140, 30), PEN: (40, 200, 255)}  # BGR


def visual_prompt_model(weights: str, device: str) -> YOLO:
    model = YOLO(weights)
    vpes = []
    for img, boxes in REFS:
        pred = YOLOEVPSegPredictor(overrides=dict(task="segment", mode="predict", batch=1, device=device, verbose=False))
        pred.set_prompts(dict(bboxes=np.array([b for b, _ in boxes], float), cls=np.array([c for _, c in boxes])))
        pred.setup_model(model=model.model, verbose=False)
        vpes.append(pred.get_vpe(img))  # (1, n_classes, dim), normalised
    # One embedding per (reference frame, class): a pen looks different at each stage, and an
    # average of a bare spring rod and a blue housing matches neither. Several embeddings share a name.
    vpe = torch.cat(vpes, dim=1)
    model.set_classes([NAMES[c] for _ in REFS for c in (MOVER, PEN)], vpe)
    return model


def annotate(frame, boxes, trails, fps_text):
    for (x1, y1, x2, y2), cls, tid, conf in boxes:
        c = COLORS[cls]
        cv2.rectangle(frame, (x1, y1), (x2, y2), c, 2)
        label = f"{NAMES[cls]} #{tid}  {conf:.2f}" if tid is not None else f"{NAMES[cls]} {conf:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        ty = y1 - 4 if y1 - th - 8 > 0 else y2 + th + 4
        cv2.rectangle(frame, (x1, ty - th - 4), (x1 + tw + 6, ty + 3), c, -1)
        cv2.putText(frame, label, (x1 + 3, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)
        if tid is not None and len(trails[tid]) > 1:
            cv2.polylines(frame, [np.array(trails[tid], np.int32)], False, c, 2, cv2.LINE_AA)
    cv2.putText(frame, fps_text, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cams", nargs="+")
    p.add_argument("--recordings", default="../../recordings/20261118-141154")
    p.add_argument("--model", default="yoloe-26l-seg.pt")
    p.add_argument("--tracker", default="bytetrack.yaml")
    p.add_argument("--seconds", type=float, default=60)
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--device", default="mps")
    a = p.parse_args()

    out_dir = pathlib.Path("out/vp-track") / pathlib.Path(a.tracker).stem
    out_dir.mkdir(parents=True, exist_ok=True)
    for cam in a.cams:
        model = visual_prompt_model(a.model, a.device)  # fresh model per camera: tracker state is per model
        cap = cv2.VideoCapture(f"{a.recordings}/{cam}.mp4")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        writer = cv2.VideoWriter(str(out_dir / f"{cam}.mp4"), FOURCC, fps, (w, h))
        trails = collections.defaultdict(lambda: collections.deque(maxlen=30))
        tracks = collections.defaultdict(set)
        track_frames = collections.Counter()
        dets = collections.Counter()
        n, t0 = 0, time.time()
        while n < a.seconds * fps:
            ok, frame = cap.read()
            if not ok:
                break
            t = time.time()
            r = model.track(frame, persist=True, conf=a.conf, tracker=a.tracker, device=a.device, verbose=False, agnostic_nms=True)[0]
            infer_ms = (time.time() - t) * 1000
            boxes = []
            for b in r.boxes:
                x1, y1, x2, y2 = map(int, b.xyxy[0].tolist())
                cls = int(b.cls) % 2  # embeddings alternate mover, pen
                tid = int(b.id) if b.id is not None else None
                dets[cls] += 1
                if tid is not None:
                    trails[tid].append(((x1 + x2) // 2, (y1 + y2) // 2))
                    tracks[cls].add(tid)
                    track_frames[tid] += 1
                boxes.append(((x1, y1, x2, y2), cls, tid, float(b.conf)))
            annotate(frame, boxes, trails, f"{cam}  YOLOE-26 + {pathlib.Path(a.tracker).stem}  {infer_ms:.0f} ms/frame")
            writer.write(frame)
            n += 1
        writer.release()
        dt = time.time() - t0
        print(f"{cam}: {n} frames, {n / dt:.1f} fps")
        for cls in (MOVER, PEN):
            ids = tracks[cls]
            mean = sum(track_frames[i] for i in ids) / len(ids) / fps if ids else 0
            print(f"  {NAMES[cls]:6s} {dets[cls] / max(n, 1):5.2f}/frame  {len(ids):3d} tracks  mean track {mean:5.1f}s")


if __name__ == "__main__":
    main()

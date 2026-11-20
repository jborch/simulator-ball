"""Auto-label the recordings with the zero-shot teacher (YOLOE-26 + visual prompts) into a YOLO dataset.

The teacher runs with a tracker over every frame. Detections are kept only if their track lives
at least --min-track frames, which drops one-off false positives, and each track gets one class
(majority vote) so a box doesn't flip between mover and pen. Every --stride-th frame is written.
Frames before --split seconds go to train, the rest to val (a time split: val is unseen footage).

usage: uv run python label.py [--split 80] [--stride 5] cam [cam ...]
"""
import argparse
import collections
import pathlib

import cv2

from vp_track import NAMES, visual_prompt_model


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cams", nargs="+")
    p.add_argument("--recordings", default="../../recordings/20261118-141154")
    p.add_argument("--out", default="out/dataset")
    p.add_argument("--model", default="yoloe-26l-seg.pt")
    p.add_argument("--tracker", default="bytetrack-tuned.yaml")
    p.add_argument("--conf", type=float, default=0.05)
    p.add_argument("--min-conf", type=float, default=0.15, help="drop boxes below this even inside a long track")
    p.add_argument("--min-track", type=int, default=12, help="frames; 12 = ~0.5 s at 25 fps")
    p.add_argument("--stride", type=int, default=5)
    p.add_argument("--split", type=float, default=80, help="seconds: train before, val after")
    p.add_argument("--device", default="mps")
    a = p.parse_args()

    out = pathlib.Path(a.out)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    for cam in a.cams:
        model = visual_prompt_model(a.model, a.device)
        cap = cv2.VideoCapture(f"{a.recordings}/{cam}.mp4")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frames = {}  # frame index -> [(tid, cls, conf, xyxy)]
        track_len = collections.Counter()
        track_cls = collections.defaultdict(collections.Counter)
        n = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            r = model.track(frame, persist=True, conf=a.conf, tracker=a.tracker, device=a.device, verbose=False, agnostic_nms=True)[0]
            dets = []
            for b in r.boxes:
                if b.id is None:
                    continue
                tid, cls, conf = int(b.id), int(b.cls) % 2, float(b.conf)
                track_len[tid] += 1
                track_cls[tid][cls] += conf
                dets.append((tid, cls, conf, b.xyxy[0].tolist()))
            if n % a.stride == 0:
                split = "train" if n / fps < a.split else "val"
                name = f"{cam}_{n:05d}"
                cv2.imwrite(str(out / "images" / split / f"{name}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
                frames[n] = (split, name, dets)
            n += 1

        kept = collections.Counter()
        dropped = 0
        for split, name, dets in frames.values():
            lines = []
            for tid, _, conf, (x1, y1, x2, y2) in dets:
                if track_len[tid] < a.min_track or conf < a.min_conf:
                    dropped += 1
                    continue
                cls = track_cls[tid].most_common(1)[0][0]
                kept[cls] += 1
                lines.append(f"{cls} {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}")
            (out / "labels" / split / f"{name}.txt").write_text("\n".join(lines) + ("\n" if lines else ""))
        print(f"{cam}: {n} frames, {len(frames)} images, kept " + ", ".join(f"{kept[c]} {NAMES[c]}" for c in range(2)) + f", dropped {dropped}")

    (out / "data.yaml").write_text(f"path: {out.resolve()}\ntrain: images/train\nval: images/val\nnames:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(NAMES)))


if __name__ == "__main__":
    main()

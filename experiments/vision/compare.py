"""Teacher (YOLOE-26 + visual prompts) vs student (fine-tuned YOLO26) on the held-out part of each recording.

Both run with the same tracker. Prints speed and track statistics, writes a side-by-side video
per camera (teacher left, student right) plus the student alone at full size.

usage: uv run python compare.py <student weights> [--start 80] cam [cam ...]
"""
import argparse
import collections
import pathlib
import time

import cv2
import numpy as np
from ultralytics import YOLO

from vp_track import FOURCC, NAMES, annotate, visual_prompt_model


class Runner:
    def __init__(self, name, model, tracker, conf, device, cls_mod):
        self.name, self.model, self.tracker, self.conf, self.device, self.cls_mod = name, model, tracker, conf, device, cls_mod
        self.trails = collections.defaultdict(lambda: collections.deque(maxlen=30))
        self.track_cls = {}
        self.track_frames = collections.Counter()
        self.dets = collections.Counter()
        self.ms = []

    def step(self, frame):
        t = time.time()
        r = self.model.track(frame, persist=True, conf=self.conf, tracker=self.tracker, device=self.device, verbose=False, agnostic_nms=True)[0]
        self.ms.append((time.time() - t) * 1000)
        boxes = []
        for b in r.boxes:
            x1, y1, x2, y2 = map(int, b.xyxy[0].tolist())
            cls = int(b.cls) % self.cls_mod
            tid = int(b.id) if b.id is not None else None
            self.dets[cls] += 1
            if tid is not None:
                self.trails[tid].append(((x1 + x2) // 2, (y1 + y2) // 2))
                self.track_cls[tid] = cls
                self.track_frames[tid] += 1
            boxes.append(((x1, y1, x2, y2), cls, tid, float(b.conf)))
        out = frame.copy()
        annotate(out, boxes, self.trails, f"{self.name}  {self.ms[-1]:.0f} ms/frame")
        return out

    def stats(self, n, fps):
        rows = []
        for cls in range(len(NAMES)):
            ids = [t for t, c in self.track_cls.items() if c == cls]
            mean = sum(self.track_frames[i] for i in ids) / len(ids) / fps if ids else 0
            rows.append(f"{NAMES[cls]} {self.dets[cls] / n:4.2f}/frame {len(ids):3d} tracks {mean:4.1f}s")
        ms = np.median(self.ms[10:]) if len(self.ms) > 10 else 0
        return f"{self.name:8s} {ms:5.1f} ms/frame (median)  " + "   ".join(rows)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("student")
    p.add_argument("cams", nargs="+")
    p.add_argument("--recordings", default="../../recordings/20261118-141154")
    p.add_argument("--start", type=float, default=80)
    p.add_argument("--tracker", default="bytetrack-tuned.yaml")
    p.add_argument("--student-conf", type=float, default=0.25)
    p.add_argument("--device", default="mps")
    a = p.parse_args()

    out_dir = pathlib.Path("out/compare")
    out_dir.mkdir(parents=True, exist_ok=True)
    for cam in a.cams:
        teacher = Runner("teacher YOLOE-26l", visual_prompt_model("yoloe-26l-seg.pt", a.device), a.tracker, 0.05, a.device, 2)
        student = Runner(f"student {pathlib.Path(a.student).parent.parent.name}", YOLO(a.student), a.tracker, a.student_conf, a.device, 2)
        cap = cv2.VideoCapture(f"{a.recordings}/{cam}.mp4")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        cap.set(cv2.CAP_PROP_POS_MSEC, a.start * 1000)
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        side = cv2.VideoWriter(str(out_dir / f"{cam}.mp4"), FOURCC, fps, (w, h // 2))
        solo = cv2.VideoWriter(str(out_dir / f"{cam}-student.mp4"), FOURCC, fps, (w, h))
        n = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t_img, s_img = teacher.step(frame), student.step(frame)
            side.write(np.hstack([cv2.resize(t_img, (w // 2, h // 2)), cv2.resize(s_img, (w // 2, h // 2))]))
            solo.write(s_img)
            n += 1
        side.release()
        solo.release()
        print(f"{cam} ({n} frames)\n  {teacher.stats(n, fps)}\n  {student.stats(n, fps)}")


if __name__ == "__main__":
    main()

"""Overlay of anomaly.py's zone scores on a camera's footage: zones above the edge of normal are
outlined, redder the further out; the camera's score and the ground truth are written at the top.

usage: uv run python anomaly_video.py ../../recordings/run1 springbase 770 880 [--variant nearest]
Writes <run>/anomaly/<cam>-<start>-<end>.mp4 (half size).
"""
import argparse
import datetime as dt
import json
import pathlib

import cv2
import numpy as np

from anomaly import load_truth
from vp_track import FOURCC


def main():
    p = argparse.ArgumentParser()
    p.add_argument("run")
    p.add_argument("cam")
    p.add_argument("start", type=float)
    p.add_argument("end", type=float)
    p.add_argument("--variant", default="nearest")
    a = p.parse_args()
    run = pathlib.Path(a.run)
    meta = json.loads((run / "run.json").read_text())
    truth = load_truth(run, dt.datetime.fromisoformat(meta["start"].replace("Z", "+00:00")))
    d = np.load(run / "anomaly" / f"{a.cam}-scores.npz")
    t, z, (gc, gr) = d["t"], d[f"{a.variant}_zone"], d["grid"]

    cap = cv2.VideoCapture(str(run / f"{a.cam}.mkv"))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    cap.set(cv2.CAP_PROP_POS_MSEC, a.start * 1000)
    w, h = 640, 360
    out = cv2.VideoWriter(str(run / "anomaly" / f"{a.cam}-{a.start:.0f}-{a.end:.0f}.mp4"), FOURCC, fps, (w, h))
    n = int(a.start * fps)
    while n < a.end * fps:
        ok, frame = cap.read()
        if not ok:
            break
        sec = n / fps
        frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)
        i = int(np.argmin(np.abs(t - sec)))
        zs = z[i]
        overlay = frame.copy()
        for k, s in enumerate(zs):
            if s <= 1:
                continue
            x0, y0 = (k % gc) * w // gc, (k // gc) * h // gr
            x1, y1 = x0 + w // gc, y0 + h // gr
            strength = min(1.0, (s - 1) / 2)
            colour = (0, int(200 * (1 - strength)), 255)
            cv2.rectangle(overlay, (x0, y0), (x1, y1), colour, -1)
            cv2.rectangle(frame, (x0, y0), (x1, y1), colour, 2)
        frame = cv2.addWeighted(overlay, 0.25, frame, 0.75, 0)
        events = [ev[2] + "@" + ",".join(sorted(ev[3])) for ev in truth if ev[0] <= sec <= ev[1] and ev[2] != "machineNotExecute"]
        score = zs.max()
        cv2.rectangle(frame, (0, 0), (w, 44), (0, 0, 0), -1)
        cv2.putText(frame, f"{a.cam}  t={sec:5.1f}s  score {score:4.2f}{'  ALARM' if score > 1 else ''}", (8, 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (80, 80, 255) if score > 1 else (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, "truth: " + ("; ".join(events) or "-"), (8, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1, cv2.LINE_AA)
        out.write(frame)
        n += 1
    out.release()


if __name__ == "__main__":
    main()

"""Cheap motion signals on a recording: per-zone motion energy (signal 1) and KLT point paths (signal 2).

Signal 1: the difference between consecutive frames, summed per grid cell (a stand-in for zones a
user would draw). Signal 2: Shi-Tomasi corners followed with pyramidal Lucas-Kanade, with a
forward-backward check that drops points the flow can't follow back. New corners are seeded every
few frames where there are none. Points that haven't moved are drawn as dots, moving ones with trails.

No model, no labels, CPU only.

usage: uv run python klt.py [--seconds 120] [--grid 4x4] cam [cam ...]
Writes out/klt/<cam>.mp4, <cam>-motion.png (zone motion over time) and <cam>-paths.npz.
"""
import argparse
import collections
import pathlib
import time

import cv2
import numpy as np

from vp_track import FOURCC

LK = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))
CORNERS = dict(maxCorners=600, qualityLevel=0.01, minDistance=8, blockSize=7)


class Points:
    def __init__(self, fb_max, trail):
        self.fb_max, self.trail = fb_max, trail
        self.pts = np.empty((0, 2), np.float32)
        self.ids = np.empty(0, int)
        self.next_id = 0
        self.paths = collections.defaultdict(list)  # id -> [(frame, x, y)]

    def step(self, prev, gray, n, seed):
        h, w = gray.shape
        if len(self.pts):
            p0 = self.pts.reshape(-1, 1, 2)
            p1, st1, _ = cv2.calcOpticalFlowPyrLK(prev, gray, p0, None, **LK)
            pb, st2, _ = cv2.calcOpticalFlowPyrLK(gray, prev, p1, None, **LK)
            fb = np.linalg.norm((p0 - pb).reshape(-1, 2), axis=1)
            p1 = p1.reshape(-1, 2)
            ok = (st1.ravel() == 1) & (st2.ravel() == 1) & (fb < self.fb_max)
            ok &= (p1[:, 0] >= 0) & (p1[:, 0] < w) & (p1[:, 1] >= 0) & (p1[:, 1] < h)
            self.pts, self.ids = p1[ok], self.ids[ok]
        if seed:
            mask = np.full((h, w), 255, np.uint8)
            for x, y in self.pts:
                cv2.circle(mask, (int(x), int(y)), CORNERS["minDistance"], 0, -1)
            new = cv2.goodFeaturesToTrack(gray, mask=mask, **CORNERS)
            if new is not None:
                new = new.reshape(-1, 2)
                self.pts = np.vstack([self.pts, new])
                self.ids = np.concatenate([self.ids, np.arange(self.next_id, self.next_id + len(new))])
                self.next_id += len(new)
        for i, (x, y) in zip(self.ids, self.pts):
            self.paths[i].append((n, x, y))

    def moving(self, window, min_px):
        """Ids whose position changed more than min_px over the last `window` frames."""
        out = []
        for i in self.ids:
            p = self.paths[i]
            a, b = p[max(0, len(p) - window)], p[-1]
            if np.hypot(b[1] - a[1], b[2] - a[2]) > min_px:
                out.append(i)
        return set(out)


def colour(i):
    rng = np.random.default_rng(int(i))
    return tuple(int(c) for c in rng.integers(60, 256, 3))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cams", nargs="+")
    p.add_argument("--recordings", default="../../recordings/20261118-141154")
    p.add_argument("--seconds", type=float, default=120)
    p.add_argument("--grid", default="4x4", help="zones, COLSxROWS")
    p.add_argument("--seed-every", type=int, default=5)
    p.add_argument("--fb-max", type=float, default=1.0, help="px; forward-backward error above this drops the point")
    p.add_argument("--trail", type=int, default=40)
    a = p.parse_args()
    gc, gr = map(int, a.grid.split("x"))

    out_dir = pathlib.Path("out/klt")
    out_dir.mkdir(parents=True, exist_ok=True)
    for cam in a.cams:
        cap = cv2.VideoCapture(f"{a.recordings}/{cam}.mp4")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        writer = cv2.VideoWriter(str(out_dir / f"{cam}.mp4"), FOURCC, fps, (w, h))
        pts = Points(a.fb_max, a.trail)
        energy = []  # per frame: (gr, gc) mean abs difference
        alive, moving_n, ms = [], [], []
        prev, n = None, 0
        while n < a.seconds * fps:
            ok, frame = cap.read()
            if not ok:
                break
            t = time.time()
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if prev is None:
                prev = gray
            diff = cv2.absdiff(cv2.GaussianBlur(gray, (5, 5), 0), cv2.GaussianBlur(prev, (5, 5), 0))
            diff[diff < 8] = 0  # ignore encoder noise
            energy.append(cv2.resize(diff.astype(np.float32), (gc, gr), interpolation=cv2.INTER_AREA))
            pts.step(prev, gray, n, seed=n % a.seed_every == 0)
            mov = pts.moving(window=10, min_px=3)
            ms.append((time.time() - t) * 1000)
            alive.append(len(pts.ids))
            moving_n.append(len(mov))

            for x in range(1, gc):
                cv2.line(frame, (x * w // gc, 0), (x * w // gc, h), (80, 80, 80), 1)
            for y in range(1, gr):
                cv2.line(frame, (0, y * h // gr), (w, y * h // gr), (80, 80, 80), 1)
            for i, (x, y) in zip(pts.ids, pts.pts):
                if i in mov:
                    tr = np.array([(px, py) for _, px, py in pts.paths[i][-a.trail:]], np.int32)
                    cv2.polylines(frame, [tr], False, colour(i), 2, cv2.LINE_AA)
                    cv2.circle(frame, (int(x), int(y)), 3, colour(i), -1)
                else:
                    cv2.circle(frame, (int(x), int(y)), 1, (160, 160, 160), -1)
            cv2.putText(frame, f"{cam}  KLT  {len(pts.ids)} points, {len(mov)} moving  {ms[-1]:.0f} ms/frame",
                        (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
            writer.write(frame)
            prev, n = gray, n + 1
        writer.release()

        energy = np.array(energy)  # (n, gr, gc)
        paths = {i: np.array(v, np.float32) for i, v in pts.paths.items()}
        moved = {i: v for i, v in paths.items() if len(v) > 1 and np.ptp(v[:, 1:], axis=0).max() > 20}
        life = np.array([len(v) for v in moved.values()]) / fps if moved else np.zeros(1)
        np.savez_compressed(out_dir / f"{cam}-paths.npz", energy=energy, fps=fps,
                            **{f"p{i}": v for i, v in moved.items()})
        plot_motion(energy, fps, gc, gr, out_dir / f"{cam}-motion.png", cam)
        period = cycle_period(energy.reshape(len(energy), -1).sum(1), fps)
        print(f"{cam}: {n} frames, {np.median(ms):.1f} ms/frame (median, CPU)\n"
              f"  points alive {np.mean(alive):.0f}/frame, moving {np.mean(moving_n):.0f}/frame\n"
              f"  {len(moved)} paths that moved >20 px: lifetime median {np.median(life):.1f}s, "
              f"p90 {np.percentile(life, 90):.1f}s\n"
              f"  dominant cycle in total motion: {period}")


def cycle_period(sig, fps):
    """Strongest repeat in a motion signal, from its autocorrelation (between 1 s and a third of the clip)."""
    s = sig - sig.mean()
    ac = np.correlate(s, s, "full")[len(s) - 1:]
    ac /= ac[0] or 1
    lo, hi = int(fps), len(s) // 3
    if hi <= lo:
        return "clip too short"
    k = lo + int(np.argmax(ac[lo:hi]))
    return f"{k / fps:.2f}s (autocorrelation {ac[k]:.2f})"


def plot_motion(energy, fps, gc, gr, path, cam):
    """One row per zone, brightness = motion. Drawn with OpenCV to avoid a plotting dependency."""
    n = len(energy)
    rows = energy.reshape(n, -1).T  # (zones, n)
    rows = rows / (np.percentile(rows, 99) or 1)
    img = (np.clip(rows, 0, 1) * 255).astype(np.uint8)
    row_h, label_w = 18, 60
    img = cv2.resize(img, (n, gc * gr * row_h), interpolation=cv2.INTER_NEAREST)
    img = cv2.applyColorMap(img, cv2.COLORMAP_INFERNO)
    canvas = np.full((img.shape[0] + 40, n + label_w, 3), 255, np.uint8)
    canvas[:img.shape[0], label_w:] = img
    for z in range(gc * gr):
        cv2.putText(canvas, f"r{z // gc}c{z % gc}", (4, z * row_h + 13), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    for s in range(0, int(n / fps) + 1, 10):
        x = label_w + int(s * fps)
        cv2.line(canvas, (x, img.shape[0]), (x, img.shape[0] + 6), (0, 0, 0), 1)
        cv2.putText(canvas, f"{s}s", (x - 8, img.shape[0] + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    cv2.putText(canvas, f"{cam}: motion per zone over time", (label_w, img.shape[0] + 36), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
    cv2.imwrite(str(path), canvas)


if __name__ == "__main__":
    main()

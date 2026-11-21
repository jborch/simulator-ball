"""Motion anomaly scoring on a recorded run (record_run.mjs): learn "normal" from the first part,
score the rest. No labels, no model, CPU only.

1. Features: the picture is split into a grid of zones (stand-ins for zones a user would draw).
   Per zone and time step: motion energy (frame difference) and the mean optical flow (dx, dy,
   Farneback on a small copy of the frame: the dense version of the KLT point paths).
2. Cycles: the dominant repeat period P of the training footage (autocorrelation, 3-20 s), and
   windows of length P slid along in 1 s steps, so every phase of the cycle is covered.
3. Normal model per zone, two variants:
   - "template": one average cycle per zone; a window is aligned to it (best time shift) and
     scored by the distance;
   - "nearest": the set of all normal cycles; a window is scored by the distance to the closest
     one (the cycle varies: robots wait for movers, feeders are irregular).
4. Score: per zone, divided by that zone's 99.5th percentile on the training footage (leave-out:
   a training window is never compared with its own neighbourhood), so 1 = the edge of normal.
   The camera's score is the highest zone score; above 1 is an alarm.

Ground truth (truth.jsonl) is used only to report how the alarms line up with what happened.

usage: uv run python anomaly.py ../../recordings/run1 [--cams cartridge,housing] [--grid 8x6]
Writes <run>/anomaly/<cam>-features.npz, <cam>.png (timeline) and summary.txt.
"""
import argparse
import datetime as dt
import json
import pathlib

import cv2
import numpy as np

# Which stations each camera sees (its own and its neighbours').
CAM_STATIONS = {
    "infeed": {"EM10", "EM11", "EM12", "bodies", "springs"},
    "springbase": {"EM13", "EM14A", "EM14B", "EM14C", "EM14D", "EM15", "bases", "orienter"},
    "cartridge": {"EM00", "EM41"},
    "housing": {"EM30", "EM31", "EM32", "EM40", "housings", "dialJam", "labelRoll"},
    "outfeed": {"EM60", "EM61", "destacker"},
}
FS = 12.5  # feature rate (every 2nd frame of 25 fps)
BIN_S = 0.5  # windows are compared at this time resolution, which tolerates a little jitter


def features(video, grid, every=2):
    gc, gr = grid
    cap = cv2.VideoCapture(str(video))
    prev = None
    rows = []
    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        n += 1
        if (n - 1) % every:
            continue
        small = cv2.cvtColor(cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        small = cv2.GaussianBlur(small, (3, 3), 0)
        if prev is None:
            prev = small
        diff = cv2.absdiff(small, prev).astype(np.float32)
        diff[diff < 6] = 0
        flow = cv2.calcOpticalFlowFarneback(prev, small, None, 0.5, 2, 9, 2, 5, 1.1, 0)
        f = np.stack([diff, flow[..., 0], flow[..., 1]], -1)
        rows.append(cv2.resize(f, (gc, gr), interpolation=cv2.INTER_AREA).reshape(-1, 3))  # (zones, 3)
        prev = small
    return np.array(rows, np.float32)  # (T, zones, 3)


def period(sig, fs, lo=3.0, hi=20.0):
    s = sig - sig.mean()
    ac = np.correlate(s, s, "full")[len(s) - 1:]
    ac /= ac[0] or 1
    a, b = int(lo * fs), min(int(hi * fs), len(s) // 3)
    k = a + int(np.argmax(ac[a:b]))
    return k / fs, float(ac[k])


def windows(x, length, hop):
    """x (T, zones, F) → (n, zones, bins*F) windows binned to BIN_S, with their start indices."""
    b = int(BIN_S * FS)
    starts = np.arange(0, len(x) - length, hop)
    out = []
    for s in starts:
        w = x[s:s + length]
        w = w[: len(w) // b * b].reshape(-1, b, *w.shape[1:]).mean(1)  # (bins, zones, F)
        out.append(w.transpose(1, 0, 2).reshape(w.shape[1], -1))
    return np.array(out, np.float32), starts


def nn_scores(test, train, exclude=None):
    """Per zone, distance from each test window to the nearest training window. (n, zones)."""
    n, z, d = test.shape
    out = np.empty((n, z), np.float32)
    for zi in range(z):
        a, b = test[:, zi], train[:, zi]
        d2 = (a * a).sum(1)[:, None] + (b * b).sum(1)[None, :] - 2 * a @ b.T
        if exclude is not None:
            d2[exclude] = np.inf
        out[:, zi] = np.sqrt(np.maximum(d2.min(1), 0)) / np.sqrt(d)
    return out


def template_scores(test, train, nbins, F):
    """Per zone, distance to the average cycle after the best circular time shift. (n, zones)."""
    def shifted(w, k):
        return np.roll(w.reshape(*w.shape[:-1], nbins, F), k, axis=-2).reshape(w.shape)

    # Align the training cycles to the first one (shift that best matches total motion), average.
    ref = train[0]
    aligned = []
    for w in train:
        k = min(range(nbins), key=lambda k: np.abs(shifted(w, k) - ref).sum())
        aligned.append(shifted(w, k))
    tmpl = np.mean(aligned, 0)  # (zones, d)
    best = np.full(test.shape[:2], np.inf, np.float32)
    for k in range(nbins):
        d = np.sqrt(((shifted(test, k) - tmpl) ** 2).mean(-1))
        best = np.minimum(best, d)
    return best


def load_truth(run, start):
    """Intervals (t0, t1, label, stations) in seconds from the start of the recording."""
    t = lambda s: (dt.datetime.fromisoformat(s.replace("Z", "+00:00")) - start).total_seconds()
    open_, out = {}, []
    for line in (run / "truth.jsonl").read_text().splitlines():
        e = json.loads(line)
        if e["event"] == "start":
            open_[e["key"]] = e
        elif e["event"] == "end" and e["key"] in open_:
            s = open_.pop(e["key"])
            where = {s.get("station"), s.get("feeder"), s.get("alarm")} - {None}
            out.append((t(s["time"]), t(e["time"]), s["kind"], where))
    return out


def alarms(score, times, thr=1.0, min_len=2):
    """Runs of windows above thr → (t0, t1, peak)."""
    out, cur = [], None
    for s, tm in zip(score, times):
        if s > thr:
            cur = [tm, tm, s] if cur is None else [cur[0], tm, max(cur[2], s)]
        elif cur is not None:
            out.append(cur)
            cur = None
    if cur is not None:
        out.append(cur)
    return [a for a in out if (a[1] - a[0]) * 1 + 1 >= min_len]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("run")
    p.add_argument("--cams", default="springbase,cartridge,housing")
    p.add_argument("--grid", default="8x6")
    p.add_argument("--warmup", type=float, default=120, help="s at the start to skip (line filling)")
    p.add_argument("--quantile", type=float, default=99.5)
    a = p.parse_args()
    run = pathlib.Path(a.run)
    meta = json.loads((run / "run.json").read_text())
    start = dt.datetime.fromisoformat(meta["start"].replace("Z", "+00:00"))
    truth = load_truth(run, start)
    grid = tuple(map(int, a.grid.split("x")))
    out_dir = run / "anomaly"
    out_dir.mkdir(exist_ok=True)
    summary = []

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    for cam in a.cams.split(","):
        cache = out_dir / f"{cam}-features.npz"
        if cache.exists():
            x = np.load(cache)["x"]
        else:
            x = features(run / f"{cam}.mkv", grid)
            np.savez_compressed(cache, x=x)
        n_train_end = int(meta["train"] * FS)
        w0 = int(a.warmup * FS)
        # Camera motion (a knock on the mount, vibration) moves every zone together. Take it out of
        # the zone flows, and report it on its own: "the camera moved" is worth knowing, but it is
        # not the process misbehaving.
        x = x.copy()
        cam_flow = np.median(x[:, :, 1:], axis=1)  # (T, 2)
        x[:, :, 1:] -= cam_flow[:, None, :]
        cam_mag = np.abs(cam_flow).sum(1)
        cam_thr = 1.5 * cam_mag[w0:n_train_end].max()
        cam_t = np.arange(len(cam_mag)) / FS
        cam_alarms = alarms(cam_mag, cam_t, cam_thr, min_len=0)
        tr = x[w0:n_train_end]
        # Each feature scaled by its spread over the training part (energy and flow differ in size).
        scale = tr.reshape(-1, 3).std(0) + 1e-6
        xs = x / scale
        robot = xs[w0:n_train_end, : grid[0] * grid[1] // 2, 0].sum(1)  # top half: robots, not the belt
        P, strength = period(robot, FS)
        length = int(round(P * FS))
        hop = int(FS)  # 1 s
        W, starts = windows(xs, length, hop)
        tw = (starts + length / 2) / FS  # window centre, s
        train_mask = (starts >= w0) & (starts + length <= n_train_end)
        Wtr = W[train_mask]
        nbins = Wtr.shape[2] // 3

        # Leave-out on the training part: never compare a window with its own neighbourhood.
        idx_tr = np.where(train_mask)[0]
        ex = np.abs(starts[:, None] - starts[idx_tr][None, :]) < 2 * length
        results = {}
        for name in ("nearest", "template"):
            raw = nn_scores(W, Wtr, exclude=ex) if name == "nearest" else template_scores(W, Wtr, nbins, 3)
            thr = np.percentile(raw[train_mask], a.quantile, axis=0) + 1e-6  # per zone
            z = raw / thr
            results[name] = (z.max(1), z)

        # Report: which ground-truth events in the test part were caught, and false alarms.
        test_t0 = meta["train"]
        lines = [f"{cam}: period {P:.1f} s (autocorrelation {strength:.2f}), {len(Wtr)} normal cycles",
                 f"  camera moved (global flow > 1.5x the normal maximum): " + (", ".join(f"{a0:.0f} s" for a0, _, _ in cam_alarms) or "never")]
        for name, (score, z) in results.items():
            al = alarms(score, tw)
            def overlaps(a0, a1, ev, margin=(3, 15)):
                return a0 <= ev[1] + margin[1] and a1 >= ev[0] - margin[0]
            in_view = [ev for ev in truth if ev[0] >= test_t0 - 5 and ev[2] != "machineNotExecute" and ev[3] & CAM_STATIONS[cam]]
            # Caught: an alarm starts within a few seconds of the event starting (an alarm that was
            # already on, for something else, doesn't count).
            # (Window times are centres, so a window already holds an event's start half a period earlier.)
            caught = [ev for ev in in_view if any(ev[0] - P / 2 - 2 <= a0 <= ev[0] + 20 for a0, a1, _ in al)]
            # An alarm explained by anything that happened anywhere (effects travel along the line).
            explained = lambda al_: any(overlaps(al_[0], al_[1], ev, (5, 40)) for ev in truth if ev[2] != "machineNotExecute")
            fa_train = [x for x in al if x[0] < test_t0 and x[0] > a.warmup and not explained(x)]
            fa_test = [x for x in al if x[0] >= test_t0 and not explained(x)]
            other = [x for x in al if x[0] >= test_t0 and explained(x) and not any(overlaps(x[0], x[1], ev) for ev in in_view)]
            lines.append(f"  {name:8s} caught {len(caught)}/{len(in_view)} in view: " + ", ".join(f"{ev[2]}@{ev[0]:.0f}s{'✓' if ev in caught else '✗'}" for ev in in_view))
            lines.append(f"  {'':8s} alarms in test: {sum(1 for x in al if x[0] >= test_t0)} ({len(other)} from events elsewhere on the line, {len(fa_test)} unexplained); unexplained in normal part: {len(fa_train)} in {(test_t0 - a.warmup) / 60:.0f} min")
        summary += lines
        print("\n".join(lines))

        fig, axes = plt.subplots(2, 1, figsize=(16, 6), sharex=True)
        for ax, (name, (score, _)) in zip(axes, results.items()):
            for ev in truth:
                if ev[2] == "machineNotExecute":
                    continue
                mine = bool(ev[3] & CAM_STATIONS[cam])
                ax.axvspan(ev[0], ev[1], color="tab:red" if mine else "tab:orange", alpha=0.25 if mine else 0.1, lw=0)
                if mine:
                    ax.text(ev[0], 0.02, ev[2], rotation=90, fontsize=7, va="bottom", transform=ax.get_xaxis_transform())
            ax.plot(tw, score, lw=0.8, color="black")
            ax.axhline(1, color="tab:blue", lw=0.8, ls="--")
            ax.axvline(test_t0, color="gray", lw=1)
            ax.axvspan(0, a.warmup, color="gray", alpha=0.15, lw=0)
            ax.set_yscale("log")
            ax.set_ylabel(f"{name}\nscore")
        axes[0].set_title(f"{cam}: anomaly score (1 = edge of normal). Red: events at this camera, orange: elsewhere. Normal footage left of the grey line, test right.")
        axes[-1].set_xlabel("s since start of recording")
        fig.tight_layout()
        fig.savefig(out_dir / f"{cam}.png", dpi=110)
        plt.close(fig)
        np.savez_compressed(out_dir / f"{cam}-scores.npz", t=tw, **{f"{k}_zone": v[1] for k, v in results.items()}, grid=np.array(grid), period=P)

    (out_dir / "summary.txt").write_text("\n".join(summary) + "\n")


if __name__ == "__main__":
    main()

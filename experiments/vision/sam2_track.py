"""SAM 2 video tracking: prompt objects with boxes on the first frame, propagate through the clip."""
import sys, time
from ultralytics.models.sam import SAM2VideoPredictor
video, boxes = sys.argv[1], [[float(v) for v in b.split(",")] for b in sys.argv[2:]]
p = SAM2VideoPredictor(overrides=dict(conf=0.25, task="segment", mode="predict", imgsz=1024, model="sam2.1_b.pt", device="mps", save=True, project="out", name="sam2", exist_ok=True, verbose=False))
t0 = time.time(); n = 0; areas = []
for r in p(source=video, bboxes=boxes, labels=list(range(1, len(boxes) + 1)), stream=True):
    n += 1
    areas.append([int(m.sum()) for m in r.masks.data] if r.masks is not None else [])
print(f"{n} frames in {time.time()-t0:.0f}s ({n/(time.time()-t0):.1f} fps)")
for i in range(0, n, 50): print(i, areas[i])

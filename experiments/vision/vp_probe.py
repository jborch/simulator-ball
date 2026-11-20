"""Visual prompts: example boxes on a reference frame define the classes; then detect on other frames."""
import numpy as np
from ultralytics import YOLO
from ultralytics.models.yolo.yoloe import YOLOEVPSegPredictor

model = YOLO("yoloe-26l-seg.pt")
names = ["mover", "pen"]
ref = "out/frames/cartridge.png"
vp = dict(bboxes=np.array([[45, 565, 358, 680], [427, 565, 662, 680], [188, 368, 252, 600], [525, 368, 580, 612]], dtype=float),
          cls=np.array([0, 0, 1, 1]))
model.predict(ref, refer_image=ref, visual_prompts=vp, predictor=YOLOEVPSegPredictor, device="mps", verbose=False)
model.model.names = names  # classes are now the visual-prompt embeddings; give them names
for cam in ["cartridge", "infeed", "springbase", "housing", "outfeed"]:
    r = model.predict(f"out/frames/{cam}.png", conf=0.25, device="mps", verbose=False)[0]
    r.save(f"out/frames/vp-{cam}.png")
    print(cam, [(r.names[int(b.cls)], round(float(b.conf), 2)) for b in r.boxes])

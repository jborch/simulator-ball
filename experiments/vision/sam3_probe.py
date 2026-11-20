"""SAM 3 text prompts on still frames: which words find movers and pens?"""
import sys, time
from ultralytics.models.sam import SAM3SemanticPredictor
p = SAM3SemanticPredictor(overrides=dict(conf=float(__import__("os").environ.get("CONF", 0.3)), task="segment", mode="predict", model="sam3.pt", half=True, save=False, verbose=False))
prompts = sys.argv[1].split(",")
for f in sys.argv[2:]:
    p.set_image(f)
    t = time.time()
    r = p(text=prompts)[0]
    ms = (time.time() - t) * 1000
    r.save(f.replace("frames/", "frames/sam3-"))
    print(f.split("/")[-1], f"{ms:.0f} ms", sorted([(r.names[int(b.cls)], round(float(b.conf), 2)) for b in r.boxes], key=lambda x: -x[1]))

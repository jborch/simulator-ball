import sys
from ultralytics import YOLO
m = YOLO("yoloe-11l-seg.pt"); m.set_classes(sys.argv[2].split(","))
for f in sys.argv[3:]:
    r = m.predict(f, conf=float(sys.argv[1]), device="mps", verbose=False)[0]
    r.save(f.replace("frames/", "frames/yoloe-"))
    print(f, [(r.names[int(b.cls)], round(float(b.conf), 2)) for b in r.boxes])

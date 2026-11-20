import sys
from ultralytics import YOLO
m = YOLO(sys.argv[1])
for f in sys.argv[3:]:
    r = m.predict(f, conf=float(sys.argv[2]), device="mps", verbose=False)[0]
    r.save(f.replace("frames/", "frames/pf-"))
    print(f.split("/")[-1], sorted([(r.names[int(b.cls)], round(float(b.conf), 2)) for b in r.boxes], key=lambda x: -x[1]))

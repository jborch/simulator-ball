# Vision experiments (temporary)

Object detection, tracking and motion experiments on the simulator's camera feeds. They don't
belong in this project and live here only while we test; they are kept apart (this directory and
its own commits) so they can be moved out or dropped in one go.

The simulator is treated as a real line: nothing here uses its internals or ground truth for
labels or training. (`INCIDENT_LOG` may be used to *score* a detector, not to train one.)

| Script | What it does |
| --- | --- |
| `track.py` | Any Ultralytics model + tracker on a recording, with optional text prompts |
| `probe.py`, `probe_pf.py`, `vp_probe.py` | Single-frame probes: YOLOE text prompts, prompt-free, visual prompts |
| `vp_track.py` | Teacher: YOLOE-26 with visual prompts (example boxes in `REFS`) + ByteTrack |
| `label.py` | Auto-labels the recordings with the teacher into a YOLO dataset |
| `compare.py` | Teacher vs fine-tuned YOLO26 student on held-out footage |
| `sam2_track.py`, `sam3_probe.py`, `sam3_track.py` | SAM 2 / SAM 3 tracking (SAM 3 run on the GPU box) |
| `klt.py` | Cheap motion signals: per-zone motion energy and KLT point paths |

Setup: `uv sync`, then `uv run python <script> --help`. Recordings go in `../../recordings/`
(git-ignored); outputs in `out/` (git-ignored).

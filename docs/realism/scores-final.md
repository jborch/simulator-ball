# Final scores and summary

Same rubric (`RUBRIC.md`) and the same three blind judges throughout: Claude Sonnet 5.5, Claude
Fable 5.2, GPT-6.2 Sol. Each judge saw only one set of 11 PNGs per verdict (absolute scores) and
never knew which round it was. Per-view means over the 11 views:

| round | what | by | Sonnet | Fable | Sol | mean |
|---|---|---|---:|---:|---:|---:|
| before | original look | – | 4.0 | 3.9 | 4.3 | **4.1** |
| r1 | hall, tables, extrusions, axes, Blender machine catalogue | Codex GPT-6.2 Astra | 6.9 | 5.6 | 6.3 | **6.3** |
| r2 | vision regressions, broken list, room-probe lighting, primitives | Claude Opus 5.5 | 7.05 | 6.64 | 6.09 | **6.6** |
| r3 | directional light, surfaces, broken list | Claude Opus 5.5 | 6.64 | 6.41 | 6.45 | **6.5** |
| r4 | grippers, Z-slides, feeders, trays, guards, press shells | Codex GPT-6.2 Astra | 7.23 | 6.86 | 6.73 | **6.94** |
| r5 | soft hall light, material separation | Claude Opus 5.5 | 7.14 | 6.86 | 6.64 | **6.88** |
| r7 | finish r6 (Astra, cut short), operator, glass, rams, labels | Claude Opus 5.5 (+ Astra) | 6.91 | 6.59 | – | (6.75) |
| r8 | bowl feeder rebuilt, even floor | Claude Opus 5.5 | 7.00 | 6.82 | 6.45 | **6.76** |

Judges' overall verdicts for the final set: **7 / 7 / 7** (before: 4 / 4 / 4).

Blind pairwise, before vs final (r7 set; Sonnet and Fable): the final image preferred in **22/22**
pairs, all at strength 3 ("overwhelmingly"); scored side by side, final ≈ 7.5–7.6, before ≈ 2.5–2.8.

## Per view, final (r8)

| image | before | Sonnet | Fable | Sol | mean | gain |
|---|---:|---:|---:|---:|---:|---:|
| overview | 3.7 | 7 | 7 | 7 | 7.0 | +3.3 |
| infeed | 4.0 | 7 | 6.5 | 6 | 6.5 | +2.5 |
| springbase | 3.8 | 7 | 7 | 6 | 6.7 | +2.9 |
| cartridge | 4.3 | 7 | 7 | 6 | 6.7 | +2.4 |
| housing | 4.0 | 7 | 7 | 6 | 6.7 | +2.7 |
| outfeed | 3.2 | 7 | 6.5 | 7 | 6.8 | +3.6 |
| hero-robot | 4.8 | 7 | 6.5 | 7 | 6.8 | +2.0 |
| hero-presses | 3.7 | 8 | 7 | 7 | 7.3 | +3.6 |
| hero-dial | 4.9 | 6 | 6 | 6 | 6.0 | +1.1 |
| hero-outfeed | 3.8 | 7 | 7 | 7 | 7.0 | +3.2 |
| hero-movers | 5.1 | 7 | 7.5 | 6 | 6.8 | +1.7 |

## Reading
- The big step was round 1 (+2.2); rounds 2 and 4 added ~0.3–0.4 each; since round 4 the score is
  flat at ~6.8–6.9, within the judges' noise (single judges move ±0.3 between near-identical sets,
  and swing between "hard sun shadows" in r3 and "flat, shadowless" in r5/r8).
- The 7.0 average target is essentially met on the judges' own overall verdicts (7/7/7) and within
  0.1–0.2 on the per-view mean; the stretch 7.5 was not reached.
- What all judges still name as the ceiling: metals that read as paint (no visible reflections),
  one grey value for floor, table and walls, a flat-shaded hall backdrop behind the glazing, nearly
  invisible guard glass, clean/uniform plastics (white movers, cream presses, saturated cyan
  housings and red totes), a texture-less belt; hero-dial: bowl contents still read as artificial.

## Vision-relevant notes (from the pairwise legibility checks)
- Pen DataMatrix codes now render on the pens and decode (checked with ZXing on housing and
  cartridge); they were plain white bands before.
- Mover side plates are legible in all station cameras, but the digits are a little smaller than
  the old plain plates (the plate now carries a barcode); top-face numbers are still hard to read
  from the low station cameras. In the overview the white movers are harder to count than the old
  yellow-topped ones.
- The gowned operator (only present while a station is faulted) can now enter close-up views.

## Cost
Render cost per frame is unchanged (overview ~6.5 ms, station cameras ~3 ms at 1600x900); six
concurrent camera feeds with camera realism hold 25 fps throughout. One sim change: EM41 carries a
held cartridge lower (`loadedTransferZ`), throughput 16.7 → 16.8 pens/min (seed noise).

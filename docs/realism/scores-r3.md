# Round 3 scores (Claude Opus 5.5, commits c4f7967..00af116: lighting, tone, surfaces, broken list)

Absolute, blind, same rubric; each judge saw only `after-r3/`.

| image | before | r2 mean (S/F/Sol) | r3 Sonnet 5.5 | r3 Fable 5.2 | r3 GPT-6.2 Sol | r3 mean |
|---|---:|---:|---:|---:|---:|---:|
| overview | 3.7 | 7.0 | 7 | 7 | 7 | 7.0 |
| infeed | 4.0 | 6.5 | 6 | 6 | 6 | 6.0 |
| springbase | 3.8 | 6.7 | 6.5 | 6 | 6 | 6.2 |
| cartridge | 4.3 | 6.5 | 6.5 | 6 | 6 | 6.2 |
| housing | 4.0 | 6.0 | 6 | 6.5 | 6 | 6.2 |
| outfeed | 3.2 | 6.0 | 6.5 | 6 | 6 | 6.2 |
| hero-robot | 4.8 | 6.7 | 7 | 6.5 | 7 | 6.8 |
| hero-presses | 3.7 | 7.2 | 7.5 | 6.5 | 7 | 7.0 |
| hero-dial | 4.9 | 6.5 | 6.5 | 6.5 | 7 | 6.7 |
| hero-outfeed | 3.8 | 6.5 | 6.5 | 6.5 | 6 | 6.3 |
| hero-movers | 5.1 | 6.8 | 7 | 7 | 7 | 7.0 |
| **per-view mean** | **4.1** | **6.59** | **6.64** | **6.41** | **6.45** | **6.50** |
| **overall** | 4 / 4 / 4 | 7 / 6.5 / 6 | 6.5 | 6.5 | 7 | |

(before and r2 columns are three-judge means: Sonnet, Fable, Sol.)

**Verdict**: flat versus round 2 (6.59 → 6.50). Sol went up (6.09 → 6.45), both Claude judges down.

## Why: all three judges, independently
- **Hard, uniformly dark shadows** ("sun-like", "shadow spaghetti" across the tabletop in cartridge,
  housing, hero-robot; blobby shadow-map patches on the white press columns). They want broad
  overhead hall light: large penumbrae, lighter shadows, and contact shadows / AO under movers,
  feeders, feet and trays instead.
- Materials still don't separate (extrusion, cabinets, table top, movers all light grey); floor
  dead-matte; backdrop flat-shaded; red bins toy-saturated; belt a flat strip.

## Round 4 scope (mechanical) items they confirmed
Box gripper with two black squares (housing, "reads as a face"); spring and cartridge hanging from
flat tool ends with no jaws/mandrel; long unguided Z shafts; guard frames with invisible panels;
press C-frames with stepped outlines and blank faces; loose grey blocks on the belt (stoppers)
without a bracket; queued movers touching with no gap; housings in the bowl too large (a handful
fill it) and standing upright on an inclined rail; trays as slabs without wall thickness/pockets;
cables ending on the table top without a gland.

## Other
- Top-face mover numbers smeared at station-camera angles (side plates fine).
- outfeed: the wall clock sits exactly behind the gripper. overview: cartons under an
  "ISO 8 clean zone" sign; exit sign cut by the frame.
- Station cameras: bottom third of infeed/springbase is blank rail profile (camera poses are
  fixed for vision, so this stays).

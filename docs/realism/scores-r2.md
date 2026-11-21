# Round 2 scores (Claude Opus 5.5, commits c9ce1ec..52c1248)

GPT-6.2 Sol could not judge yet (Codex usage limit). Absolute: judges saw only `after-r2/`.
Pairwise: round 1 vs round 2, random A/B order per view.

| image | before | r1 (S/F) | r2 Sonnet 5.5 | r2 Fable 5.2 | r2 mean | gain vs before |
|---|---:|---:|---:|---:|---:|---:|
| overview | 3.3 | 7 / 6 | 7 | 7 | 7.0 | +3.7 |
| infeed | 4.0 | 7 / 6 | 7 | 6.5 | 6.75 | +2.75 |
| springbase | 3.7 | 7 / 6 | 7 | 7 | 7.0 | +3.3 |
| cartridge | 4.0 | 7 / 5 | 7 | 6.5 | 6.75 | +2.75 |
| housing | 4.0 | 7 / 6 | 7 | 6 | 6.5 | +2.5 |
| outfeed | 3.3 | 6 / 5 | 6.5 | 5.5 | 6.0 | +2.7 |
| hero-robot | 4.7 | 7 / 6 | 7 | 7 | 7.0 | +2.3 |
| hero-presses | 3.5 | 8 / 7 | 7.5 | 7 | 7.25 | +3.75 |
| hero-dial | 4.8 | 7 / 5 | 7 | 6.5 | 6.75 | +1.95 |
| hero-outfeed | 3.7 | 6 / 5 | 7 | 6.5 | 6.75 | +3.05 |
| hero-movers | 5.2 | 8 / 6 | 7.5 | 7 | 7.25 | +2.05 |
| **per-view mean** | **4.0** | **6.9 / 5.6** | **7.05** | **6.64** | **6.84** | **+2.8** |
| **judge's overall** | 4 | 7 / 6 | 7 | 6.5 | | |

Pairwise r1 vs r2: round 2 preferred in **21/22** (Fable 11/11, Sonnet 10/11; Sonnet preferred r1
in hero-presses at strength 1). Mostly strength 2.

Visibility (pairwise judges): movers much easier to see in r2 almost everywhere; plates at least as
legible, except hero-dial (light mover on a light rail/table); filled cartridges much easier; empty
clear tubes harder to see (infeed, springbase, hero-robot, hero-dial).

Render cost (median ms/frame, 1600x900): overview 5.4 → 5.9, infeed 2.7 → 2.7, housing 3.0 → 2.9,
hero-robot 3.4 → 3.6 (r1 → r2, same-day measurement). 6 feeds with camera realism: 25 fps each.

## Consensus for what still holds it below 7.5
1. Lighting/tone: flat, overcast, washed-out pale grey; floor, benches and walls at the same value;
   weak contact shadows; metals without streak highlights (and charcoal on unlit faces).
   outfeed is hazy/underexposed with a dark blurry smudge on the foreground bench.
2. Bench-top scratch texture far too large in scale and visibly tiling; floor streaks.
3. End effectors: box gripper with two black squares ("cartoon face", housing), Z-axes as
   box + chrome rod + box; need parallel grippers with jaws, cylinder bodies, fittings, sensors.
4. Guarding: open line; existing guard glass invisible (no tint/reflection/gaskets).
5. Belt: flat two-tone band with a teal stripe that reads as an artefact; diamond specks.
   Stopper unit reads as a featureless grey block on the belt.
6. Saturated red totes slightly toy-like; white press shells and trays still slab-like.
7. Hall backdrop flat (tanks, cabinets behind glass); signs hang with no suspension.

## Broken / regressions
- Empty clear tubes vanish against grey/chrome (infeed, springbase, hero-robot, hero-dial).
- hero-dial: light mover on light surroundings; faceted blue housings, lowest one cuts the bowl rim.
- Second top-plate number reads upside down from the camera side (looks mirrored).
- Vision ring light unlit (infeed).
- cartridge: an amber cartridge seems to hang at the top beside the Z-axis; loose hoses ending on the bench.
- Orphan cable trunking segments on benches (hero-outfeed, overview).
- hero-outfeed: tray stack corner touches the REJECT tote.
- Jagged stair-stepped edges on the feeder chute and tray rack (infeed, hero-movers background).
- Conduit crosses a wall sign (hero-movers); "…/03" sign clipped by the frame.
- Press label/caution sticker lost from the camera-facing face (hero-presses).

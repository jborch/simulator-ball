# Round 1 scores (Codex GPT-6.2 Astra, commit b92545b)

GPT-6.2 Sol could not judge this round (Codex usage limit). Judges saw only `after/` (absolute) or
random-ordered A/B pairs (pairwise); they never saw which was which.

| image | before (mean of 3) | Sonnet 5.5 | Fable 5.2 | r1 mean | gain |
|---|---:|---:|---:|---:|---:|
| overview | 3.3 | 7 | 6 | 6.5 | +3.2 |
| infeed | 4.0 | 7 | 6 | 6.5 | +2.5 |
| springbase | 3.7 | 7 | 6 | 6.5 | +2.8 |
| cartridge | 4.0 | 7 | 5 | 6.0 | +2.0 |
| housing | 4.0 | 7 | 6 | 6.5 | +2.5 |
| outfeed | 3.3 | 6 | 5 | 5.5 | +2.2 |
| hero-robot | 4.7 | 7 | 6 | 6.5 | +1.8 |
| hero-presses | 3.5 | 8 | 7 | 7.5 | +4.0 |
| hero-dial | 4.8 | 7 | 5 | 6.0 | +1.2 |
| hero-outfeed | 3.7 | 6 | 5 | 5.5 | +1.8 |
| hero-movers | 5.2 | 8 | 6 | 7.0 | +1.8 |
| **overall** | **4.0** | **7** | **6** | **6.5** | **+2.5** |

Pairwise (blind): the after image preferred in **22/22** pairs, strength 3 ("overwhelmingly") in
21, 2 in one (hero-outfeed, Fable). Fable noted the clean-room backdrop makes the variant
recognisable, so the blinding is weak.

Render cost (headless Chrome, Metal, 1600x900, median ms/frame): overview 6.7 → 5.3, infeed
3.0 → 2.3, housing 3.4 → 2.6, hero-robot 3.4 → 3.5. Six concurrent capture feeds with camera
realism at 1280x720: all hold 25 fps, before and after.

## Still weak (both judges)
- Metals barely reflect; lighting is flat ambient, weak contact shadows under tables, cabinets, bins.
- Hall backdrop is flat-shaded cut-outs (cylinders, cabinets behind glazing); one grey-green hue.
- Large bare table tops and floor; no surface variation (scuffs, seams, gloss).
- Remaining primitives: CF12 collet feeder cylinder, blank dial plate, black motor blocks, HMI box,
  gripper jaws, outfeed trays and tray holders, reject crates without ribs; white press shells
  without seams; hoses without slack, fittings or clips.
- Clear body tubes and cartridges read as milky rods (no rim, no wall thickness).

## Broken / regressions
- **Vision-relevant**: rail clamps clip the mover ID plates in the springbase camera (30, 31);
  mover top labels small and blurry; movers low-contrast (grey on dark belt on grey table); clear
  tubes and cartridge fill wash out against the bright room; stop pins, side tags and status LEDs
  harder to see; "missing part" marker barely visible.
- Wall signs (PROCESS / 07, AIRLOCK) fragmented behind posts in every station camera.
- Floating bright horizontal bar at guard height (infeed, cartridge, springbase, outfeed).
- Unexplained dark slabs on table tops (hero-outfeed, hero-robot, springbase, outfeed).
- hero-dial: housings standing unsupported on the sloped rail, clipping in the bowl; black cube on
  the dial plate without a bracket.
- hero-presses: stray cream spheres on/near the track; white beads on the far belt.
- hero-outfeed: white pin in the reject bin, floating stubs at tray conveyor ends.
- cartridge: thin dark diagonal line across the table; springbase: floating black EM13 beam.
- Press columns' aperture shows a gap through to the wall (look hollow).

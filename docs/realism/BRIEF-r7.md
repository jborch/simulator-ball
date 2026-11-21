# Round 7 brief: finish round 6, then fix the round 5 defects (final round)

Read `BRIEF.md` (hard constraints), `BRIEF-r6.md`, `scores-r5.md`, and view `after-r5/`.

## A. Finish round 6 (Codex GPT-6.2 Astra ran out of usage mid-round)
Astra committed `e112a28` (profiled transfer fingers, spring bore engagement, mover buffers) and left
**uncommitted work in the tree** that you take over (review it, keep what's good, finish it):
- `src/sim/robot.ts`, `config.ts`, `equipment.test.ts`: `loadedTransferZ` so EM41 carries a held
  cartridge lower (fixes the cartridge that appears to hang in mid-air at the top of the cartridge
  camera, BRIEF-r6 item 1). **`src/sim/faults.test.ts` "EM00 drops a cartridge…" now fails**: find
  out why and fix it properly (sim behaviour must stay correct; adjust the test only if its
  assumption is what changed legitimately). Check it doesn't change throughput noticeably
  (`npx tsx tools/scripts/calibrate.ts` before/after, or the relevant tests).
- `src/view/devices.ts`: a new housing bowl feeder (`housingBowl`: right-scaled 440 mm bowl, spiral
  shelf, discharge tongue, retaining rails, piled blanks) — item 3; finish and verify in hero-dial.
- `src/view/bases.ts`: supports for the loop returns (item 6); verify in the overview.
- `public/textures/*_ao.png` rebaked; `hardware.ts`, `station.ts` small changes.
Then the remaining BRIEF-r6 items: 7 (EM14A/B labels hidden by a post; kinked hoses → smooth),
8 (small red tote overlapping a frame foot in infeed/hero-robot; orphan dark blot on the bench in
hero-robot). Verify items 2, 4, 5 from e112a28 in their views (spring visibly gripped in infeed,
bumpers on queued movers, V-jaws on the round part in housing).

## B. Round 5 defects (two or three judges each)
1. **Operator figure** (`scene.ts` `Person`): no visible head under the hood, stiff tube arms,
   cone "mitten" gloves, a glove detached from the body, reaching through the press tooling. Build a
   believable gowned cleanroom operator (hood with face opening + mask + goggles, shoulders, bent
   elbows, five-finger or at least mitt-shaped gloves attached to sleeves), standing clear of the
   tooling at a service position. It appears in station cameras only while a station is faulted.
2. **Guard glass**: bright vertical white streaks on panes look like a shader artefact (hero-outfeed,
   hero-presses); door handles float on invisible glass; panes invisible in the overview. Want a
   faint Fresnel reflection + slight tint + edge/gasket line, no streaks.
3. **Press rams and guide rods** render frosted / semi-transparent: ground steel instead.
4. **Mover top plates** show dark vein-like lines (cracked marble) in the housing camera.
5. **Top-face mover labels** smear into strips at the low station-camera angle (side plates fine):
   fix (anisotropic filtering/mip bias, contrast) or drop them.
6. Speckled highlights on fine rail edges, bowls, bins (cartridge, hero-movers, hero-outfeed):
   specular aliasing; tame it (roughness floor for small/curved metal, normal-map mip care).

Don't re-tune the overall lighting. Keep the perf budget and DataMatrix decodability.

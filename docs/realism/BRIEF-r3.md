# Round 3 brief: lighting, tone, surfaces and the broken list

Read `BRIEF.md` (governing brief and hard constraints), `BRIEF-r2.md`, and `scores-r2.md` (the
judges on round 2: about 6.8/10, up from 4.0). Compare `after-r2/` with `after/` and `before/`.

**Scope of this round**: everything EXCEPT the mechanical models. A later round 4 (Codex GPT-6.2
Astra) rebuilds grippers, Z-axes, stopper units, guarding/glazing and press shells in Blender;
don't spend time on those (small fixes to them are fine if they're part of a broken item below).

**Bar**: blind absolute re-score ≥ 7.5/10 average, no view below 6.5, and the round 2 broken list
gone, with no new vision regressions.

## 1. Lighting and tone (the judges' #1 by far)
The image is flat, overcast and washed-out pale grey; floor, bench tops and walls sit at the same
value; contact shadows are weak; metals show no streak highlights and go charcoal on unlit faces.
- A real key direction with soft but defined shadows; stronger contact shadows / AO under benches,
  cabinets, stands, totes, trays and movers; deeper blacks and more tonal separation (e.g. a
  mid-grey floor, distinct bench top, walls that sit back).
- Metals: bright ceiling strips in the reflection environment so extrusions, rails and bowls get
  streak highlights; consistent look across lit and unlit faces.
- outfeed camera: hazy/underexposed with a dark blurry smudge on the foreground bench; fix.
- Check all four presets (day, evening, night, dim) and `?fx=1`; night is currently very dark.
- Keep the station cameras' subjects (movers, number plates, pens, DataMatrix) at least as
  legible as now; don't let shadows fall across them so heavily that vision suffers.

## 2. Surfaces
- Bench-top scratch texture: 3–5x smaller scale, much subtler, no visible tiling; cleanroom
  stainless, not scuffed workshop.
- Floor: remove streaky look; subtle gloss, joints.
- Belt: real belt surface (fine texture, edge), remove the teal stripe artefact and diamond specks.
- Red totes slightly less saturated, more roughness variation.
- Hall backdrop: tanks/cabinets behind glass less flat, walls with depth; suspend hanging signs.

## 3. Broken list from scores-r2.md
Empty clear tubes vanishing against grey/chrome (give them edge contrast without making them milky);
hero-dial light mover on light surroundings; faceted blue housings and the one cutting the bowl rim;
the upside-down second top-plate number (pick one clear solution, e.g. one number reading from the
camera side); unlit vision ring lights; the amber cartridge that seems to hang at the top in the
cartridge view; loose hoses ending on the bench; orphan trunking segments; tray stack touching the
REJECT tote; jagged stair-stepped edges on the feeder chute and tray rack; conduit across a wall
sign; the clipped "…/03" sign; the press label/caution sticker on the camera-facing face.

Keep performance (median ms/frame for overview, infeed, housing, hero-robot with `--timing`, and the
6-feed test `node /tmp/realism-scripts/feeds.mjs`; set `PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer`).

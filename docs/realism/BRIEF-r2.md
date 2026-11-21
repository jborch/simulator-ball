# Round 2 brief

Round 1 (commit b92545b, Codex GPT-6.2 Astra) took the look from 4.0 to 6.5/10: hall, machine
tables and cabinets, extrusion frames, linear axes, pneumatics, Blender-scripted models
(`tools/blender/machine.py`, `lighting.py`, `contacts.py`, `src/view/{hall,bases,cells,hardware,occlusion}.ts`).
Read `docs/realism/BRIEF.md` (still the governing brief and constraints) and
`docs/realism/scores-r1.md` (what the judges said about round 1), and look at
`docs/realism/after/` vs `docs/realism/before/`.

**Bar for round 2**: blind absolute re-score averages ≥ 7.5/10 (no view below 6.5), and every item
in the "Broken / regressions" list of scores-r1.md is gone.

## 1. Fix the vision regressions first (non-negotiable)

The station camera feeds are used for machine vision. In every station camera view:
- Mover side ID plates (the numbers) fully unobstructed: move/redesign the guide-rail clamps so
  they never overlap a plate (springbase shows 30/31 clipped).
- Movers must stand out from belt and table again: realistic, but with contrast (e.g. an anodised
  coloured or light top plate, a lighter body against the dark belt, or a darker table top).
- Mover top labels larger/crisper; status LED and the "missing part" marker clearly visible;
  stop pins visible as real stopper units.
- Clear parts (body tubes, cartridges, glass) must read against the bright room: rim highlights,
  wall thickness, slight tint; the cartridge fill colour visible again.
- Pen DataMatrix and housing labels legible as before.
- Reject containers findable at a glance: real reject bins are often red or carry a red lid/label;
  a functional red is fine as long as it's a real moulded container (ribs, rim, handles).
Check every station camera (and `--wait-for-mark` for housing/cartridge) at full resolution.

## 2. Fix the broken list in scores-r1.md
Sign fragments behind posts (move or re-place signs so the fixed cameras don't see them cut up),
floating bright bar at guard height, unexplained dark slabs on table tops, unsupported housings on
the sloped rail and clipping in the bowl, the bracket-less black cube on the dial, stray spheres
and beads at the presses, pin in the reject bin, floating stubs at the tray conveyor, the diagonal
hairline in the cartridge view, the floating EM13 beam, hollow-looking press apertures.

## 3. Push realism (judges' consensus, by gain per effort)
1. Lighting: metals barely reflect and the light is flat ambient. Make the env map actually show
   on aluminium/steel (intensity, roughness), add stronger contact shadows/AO under tables,
   cabinets, bins, trays and feet, cut the ambient fill, add some light direction and falloff.
2. Hall backdrop: flat-shaded cut-outs in one grey-green hue. Shade it properly (lit geometry,
   ceiling with fixtures, glossy epoxy floor, depth/haze), vary colours a little.
3. Surface variation: roughness variation, scuffs, seams, belt seam, slight wear on pucks.
4. Replace remaining primitives: CF12 collet feeder cylinder, blank dial plate (nests, bolts,
   tooling), black motor blocks (fins, connectors, nameplates), HMI box (screen content), gripper
   jaws, outfeed trays/tray holders (pockets, rims), reject crates (ribs).
5. White press shells: panel seams, fasteners; hoses with slack, push-in fittings and clips.
6. Populate the empty table tops sensibly (cable ducts with lids, air-prep unit, terminal boxes),
   or shrink the empty left table.

Keep: performance (re-measure: median ms/frame per view, and the 6-feed test below), all four
lighting presets (check night and dim), camera realism `?fx=1`, the object oracle.

6-feed test: `node /tmp/realism-scripts/feeds.mjs` from the repo root (prints renders/s per feed;
camera realism does 4 renders per frame, so 100 = 25 fps). Set
`PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer` if Chrome isn't found.

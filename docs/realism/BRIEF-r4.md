# Round 4 brief: the mechanical models and the working interfaces

Read `BRIEF.md` (governing brief and hard constraints), then `scores-r2.md` (incl. the GPT-6.2 Sol
addendum) and `scores-r3.md` if present. Rounds 2 and 3 (Claude Opus 5.5) did movers, clear parts,
lighting, tone, surfaces and broken details; this round is the 3D modelling in Blender
(`tools/blender/machine.py`, `parts.py`) and its assembly in `src/view`.

**Bar**: blind absolute re-score ≥ 7.5/10 averaged over three judges (GPT-6.2 Sol is the harshest:
6.1 on round 2), no view below 6.5, and no new vision regressions (BRIEF.md hard constraints).

The harshest judge's core complaint: **you can't see how the machine handles the parts**. Close-ups
and inspection-camera views expose generic rectangular geometry exactly where the machine touches
the product. Fix the working interfaces, station by station:

1. **End effectors**: replace box grippers ("cartoon face" in the housing camera) with task-specific
   tools: a two-finger parallel gripper with jaw inserts shaped to the pen body / housing; a spring
   pick with a visible capture feature; a cartridge gripper; a press tool with a locating nose that
   is centred on the tube mouth (now visibly offset next to mover 15 in hero-presses).
2. **Z-axes**: box + long chrome rod + box → a real guided slide or cylinder body (guide rods,
   bearing block, reed sensors, push-in fittings), shorter exposed rod; servo motors with fins,
   connector, nameplate.
3. **Feeders**: bowl-to-track handoff with a visible escapement/singulator and lateral capture on
   the linear tracks; feeder track ends with a locating stop.
4. **Dial**: nest inserts with locating shoulders, smooth (non-faceted) rim, an indexer drive body.
5. **Trays and packing**: deeper tray pockets with crisp rims (fix speckled rims), locating stops and
   guides with adjustment hardware for the packing tray; tray stacks seated on their supports.
6. **Stopper units** on the belt: a real pneumatic stop (body, fitting, cable) rather than a grey block.
7. **Pneumatics and cables**: every hose and cable ends at a fitting, gland or valve; clips along
   stationary frames; short drag chains or restrained service loops on moving axes (no long
   unsupported loops).
8. **Guarding**: guard panels legible as polycarbonate (edge tint, restrained reflections, panel
   retainers, hinges, handles, interlock switches); extend guarding across the exposed press and
   transfer zones, but keep the five station cameras' views of movers, plates and pens clear.
9. **Press shells**: edge radii, panel seams with fasteners, access covers, nameplate.

Stay consistent with the lighting/materials from rounds 2–3 (don't re-tune the lighting). Keep the
per-frame cost flat (merge/instance repeated hardware): re-measure `--timing` for overview, infeed,
housing, hero-robot and the 6-feed test (`node /tmp/realism-scripts/feeds.mjs`, set
`PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer`).

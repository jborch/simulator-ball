# Round 6 brief: the recurring mechanical items

Read `BRIEF.md` (hard constraints) and `scores-r4.md`. Rounds 4 (you) and 5 (Claude Opus: soft
lighting, materials) are committed; compare `after-r5/` with `after-r4/`. Don't re-tune lighting
or materials. Fix the items the judges have flagged repeatedly, each one verified in the view where
it was seen:

1. **cartridge camera**: an amber cartridge appears to hang in mid-air at the top centre (flagged in
   every round). Whatever carries it (EM00 de-nesting gripper / collet transfer?) must be visibly
   holding it in that camera: jaws around it, a visible carriage, or a different pose/geometry.
2. **infeed camera**: the spring hangs from the tool with no visible grip/pin engagement.
3. **hero-dial**: housings in the bowl far too large (5–6 fill it, some cut the bowl wall) and no
   spiral track; parts at the right scale (dozens), a spiral track, an exit to the escapement; the
   housings on the escapement rail hang tilted without visible guides: give them guides/supports.
4. **Movers queue with zero gap** (housing 30/31, hero-robot 08–12): add realistic bumpers / buffer
   pads front and back so touching movers read as pallets buffering against each other. If the sim
   spacing must change for this, change it in `src/sim` config/layout with tests passing; keep mover
   side plates and camera legibility.
5. **Gripper pads** read as square blocks; contact with the round part ambiguous: V-jaws / profiled
   inserts that visibly wrap the round part.
6. **overview**: loop returns look unsupported at the bench ends: add a support/leg or bracket.
7. **hero-presses**: "EM14A/B" press labels' leading letter hidden by a post (move the label);
   hoses rendered as kinked polylines: smooth them (more segments / splines).
8. **infeed, hero-robot**: small red tote overlaps a frame foot; **hero-robot**: orphan dark blot
   on the bench near the left gantry foot (maybe the baked contact map, `tools/blender/contacts.py`;
   rebake if geometry moved).

Keep the perf budget (`--timing` and the 6-feed test) and DataMatrix decodability. If you move
geometry that the baked contact maps depend on, rebake them (see public/ASSETS.md).

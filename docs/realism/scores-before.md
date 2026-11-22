# Baseline scores (before)

Three independent judges, each shown only the 11 PNGs in `before/` and `RUBRIC.md`.

| image | GPT-6.2 Sol | Sonnet 5.5 | Fable 5.2 | mean |
|---|---:|---:|---:|---:|
| overview | 4 | 3 | 3 | 3.3 |
| infeed | 4 | 4 | 4 | 4.0 |
| springbase | 4 | 3 | 4 | 3.7 |
| cartridge | 5 | 4 | 3 | 4.0 |
| housing | 4 | 4 | 4 | 4.0 |
| outfeed | 3 | 4 | 3 | 3.3 |
| hero-robot | 5 | 4.5 | 4.5 | 4.7 |
| hero-presses | 4 | 3.5 | 3 | 3.5 |
| hero-dial | 5 | 5 | 4.5 | 4.8 |
| hero-outfeed | 4 | 4 | 3 | 3.7 |
| hero-movers | 5 | 5.5 | 5 | 5.2 |
| **overall** | **4** | **4** | **4** | **4.0** |

## Consensus problems

- Empty environment: infinite grey plane, black void with a hard horizon in every station camera.
- One matte grey material for all structure; saturated toy-red bins and primary-blue beams.
- Solid square posts instead of aluminium extrusion; no conveyor supports, so the loop floats.
- Mechanisms are bare bars and blocks: no linear axes, motors, drag chains, press bodies, lens barrels.
- No guarding, cabinets, HMI, cabling, pneumatics.
- Broken: z-fighting red chute/panel; gantry leg through a bin; floating red block at the tray
  table; stoppers clipping pucks; rams through crossbeams; aliased shadows; unexplained teal dots
  and black planks at the presses; dark band at the top of the overview.

## GPT-6.2 Sol

### Top improvements
1. Reusable conveyor support assembly (legs, crossmembers, adjustable feet) under long runs and returns; visible mounts for outfeed blocks and totes.
2. Soft contact shadows where feet meet floor, movers meet track, fixtures meet plates.
3. One reusable aluminium extrusion profile with slots, corner brackets, end caps, bolts.
4. Red bins: moulded lips, rounded corners, subdued plastic; yellow only where it must stand out.
5. Motion axes: motor housings, guide blocks, tool plates, cable chain or air line.
6. Legible part handoffs: bowl track into a retained feed rail, recessed dial nests, tray locating stops.
7. Factory context: sealed floor, wall or column cues, broad overhead lighting.
8. Clear guards around press and transfer zones with panel frames and door hardware.

## Sonnet 5.5

### Top improvements
1. Closed factory hall instead of plane + void + horizon (floor joints, walls/ceiling, soft env map).
2. De-toy the reds: darker, duller, rolled lip, wall thickness, label plate; or grey/green totes.
3. Extrusion-style frames with corner brackets, end caps, bolts; thinner members, bracing, guards.
4. Cable and pneumatic runs, cable chains.
5. Ground everything: AO, contact shadows, floor bolts, floor marking tape, cable trays.
6. Belt weave texture, brushed rail, slotted aluminium side profile, drive/idler end.
7. Pens with clear-coat and printed marks, translucent tubes; less toy-foam mover plates.
8. Scale/clutter cues: cabinets, stack lights, warning labels, fences, HMI; anodised axes with motors.

## Fable 5.2

### Top improvements
1. Factory hall: walls, ceiling with strip lights, glossy epoxy floor with yellow safety lines and wear.
2. Industrial HDRI, differentiated PBR materials, AO, soft higher-resolution shadows.
3. Replace red boxes with grey/blue Euro containers or stainless chutes; muted anodised beams.
4. Slim 40–45 mm T-slot extrusions with brackets, end caps, levelling feet.
5. Real conveyor: legs, braces, slotted side profiles, drive motor at the turn, belt texture, pneumatic stoppers.
6. Guarding and machine furniture: polycarbonate panels, cabinet, HMI, e-stops, stack light poles.
7. Cables and pneumatics: drag chains, hoses, trunking, valve islands, M12 sensor cables.
8. Real mechanisms: C-frame presses with round rams; linear axes with rails, carriage, motor; fingered gripper; camera lens barrel and ring light; indexer housing; bowl spiral track and drive base.

### Broken (most detailed list)
- Floating conveyor (no legs), leg through the red bin and moiré patch inside it (hero-outfeed).
- Red block hanging off the tray table; red chute with jagged notches/speckle (z-fighting).
- Yellow stop cylinders intersecting pucks; a lone stopper on empty belt reads as a lost part.
- Housing labels on the dial fragment into blocky patches; red wedge under the dial plate.
- Aliased floor shadows; black planks on the floor and teal dots at the presses; rams through crossbeams.
- Puck top numbers smeared/mirrored at station-camera angles; blank white tags on puck sides.
- Bottom third of several station frames is a featureless conveyor side wall; dark band at the top of the overview.

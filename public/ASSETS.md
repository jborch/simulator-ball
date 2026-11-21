# Render assets

Everything is generated: there are no downloaded textures or HDRIs.

From the repository root, regenerate the machine catalogue and product models with Blender 5.3.

```sh
blender -b -P tools/blender/machine.py
blender -b -P tools/blender/parts.py -- public --no-render
node tools/scripts/shots.mjs /tmp/line-bake --only overview --wait 1 --bake-contacts
```

The last command exports the installed, stationary line meshes and bakes two 1536 × 960 ambient occlusion maps (floor and deck) in Blender.

The machine catalogue contains the extrusion cross section, actuators, servo motors, grippers and fingers, vision cameras, pallet stoppers, guide rail holders, press castings, the vibratory base, rotary indexer, gearmotor, pneumatic valves, air service unit, terminal box, the reject tote and operator garments. The view assembles these in metres around the simulation's travel axes and pick points.

Generated in the browser at load: the reflection and ambient probe of the room (`src/view/environment.ts`, one per lighting preset), hall finishes (wall panels, epoxy floor and its gloss cloud), the belt's twill, the decks' fine brushed stainless (colour and roughness, at a fixed metric scale), worn carrier finishes, the moulded gloss of the reject totes, coverall fabric, signage, equipment and rating plates, the HMI screen, the gauge dial, carrier ID plates, DataMatrix codes and contact shadows (including the carriers' soft footprint shadow).

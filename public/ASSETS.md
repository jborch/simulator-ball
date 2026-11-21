# Render assets

The local 1K reflection panorama is **Industrial Workshop Foundry**, photographed by Dimitrios Savva and processed by Jarod Guest. Poly Haven releases the image under CC0. The local copy is white-balanced and partially desaturated for the production suite. [Asset and licence](https://polyhaven.com/a/industrial_workshop_foundry) · [original HDR download](https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/industrial_workshop_foundry_1k.hdr)

From the repository root, regenerate the machine catalogue and product models with Blender 5.3.

```sh
blender -b -P tools/blender/machine.py
blender -b -P tools/blender/parts.py -- public --no-render
blender -b -P tools/blender/lighting.py -- /path/to/original_1k.hdr
node tools/scripts/shots.mjs /tmp/line-bake --only overview --wait 1 --bake-contacts
```

The last command exports the installed, stationary line meshes and bakes two 1536 × 960 ambient occlusion maps in Blender.

The machine catalogue contains the extrusion cross section, actuator and drive components, vibratory base, rotary indexer, pneumatic valves, tote and operator garments. The view assembles these in metres around the simulation's travel axes and pick points. Hall finishes, belt weave, signage, equipment labels, the HMI and contact shadows are generated locally.

# Round 5 brief: soft hall light and material separation

Read `BRIEF.md` (hard constraints) and `scores-r3.md`. Round 3 made the light directional; all three
judges independently marked it down for it (per-view mean 6.59 → 6.50): **hard, uniformly dark,
sun-like shadows** ("shadow spaghetti" from gantry frames across the table tops in cartridge,
housing, hero-robot; blobby shadow-map patches on the white press columns in hero-presses).
Round 4 (Codex Astra) then rebuilt the mechanics; compare `after-r4/` with `after-r3/`.

**Goal**: the look of a real cleanroom hall lit by many large overhead luminaires: broad soft light,
shadows that are soft, light and short, with dark contact shadows / occlusion only where things
touch (movers on the belt, feet, feeders, trays, cabinets, totes). Not flat either: round 2 was
called "flat overcast"; keep form shading and tonal separation.

Ideas (measure; pick what works in three.js r187 within the perf budget):
- wider penumbra (PCFSoft/VSM with a larger radius or blur), a lower shadow intensity
  (`light.shadow.intensity`), a higher sun elevation so frame shadows are short, more fill from the
  room environment; maybe two softer shadow casters instead of one hard one, if affordable
- contact shadows: the baked floor/deck AO (`tools/blender/contacts.py`, `src/view/contact.ts`)
  plus cheap per-object contact darkening under movers, trays and feet
- no shadow-map acne/blobs on large white surfaces (press columns, cabinets)

Also, materials and small items the judges listed:
- separate the materials: anodised extrusion (cool, semi-gloss), powder-coated cabinets (warm
  RAL 7035), stainless table top (finer brushing), white mover housings, matte black nests
- floor: low-roughness epoxy with faint reflections of luminaires, smaller/no tile joints
- red totes a little darker and less saturated; blue pen bodies satin with slight variation
- top-face mover numbers smeared at station-camera angles: make them crisp (mipmaps/anisotropy,
  size) or drop them if the side plate already carries the number
- outfeed camera: the wall clock sits exactly behind the gripper; move the clock
- overview: cartons on the shelf under an "ISO 8 clean zone" sign (use sealed totes); exit sign
  cut off by the frame
- check day, evening, night, dim and `?fx=1`; keep the station cameras' subjects at least as
  legible (DataMatrix decodes, mover plates crisp)

Don't change the mechanical models (round 4). Keep the perf budget: `--timing` for overview, infeed,
housing, hero-robot, and the 6-feed test (`node /tmp/realism-scripts/feeds.mjs`, set
`PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer`).

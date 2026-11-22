# Rubric: how "real" does this 3D render of a factory line look?

The images are real-time WebGL (three.js) renders of a simulated pharmaceutical pen-injector
assembly line: movers (pucks) on a belt loop, pick-and-place robots, feeders, a labelling dial,
presses, tray packing. 11 views: an overview, five fixed station cameras (low, level views across
the belt, as inspection/monitoring cameras would see them) and five close-ups ("hero-*").

The goal is NOT photorealism. The goal is that it reads as a real industrial machine rather than a
toy / Playmobil / low-poly game. Judge it as an industrial-automation engineer would.

Score each image 1–10 on REALISM:

- 1–2  Toy-like: primary-colour blocks, plain boxes and cylinders, no material sense, floating look.
- 3–4  Clean schematic / CAD-blockout: right layout, but untextured primitives, flat lighting.
- 5–6  Credible visualization: real-world materials begin to read (metal, plastic, rubber),
       some machine detail, grounded lighting; still clearly "a game engine".
- 7–8  Convincing industrial digital-twin render: proper materials, aluminium extrusion frames,
       guarding, cables/pneumatics, believable proportions and colours, good lighting & contact
       shadows, an environment that reads as a factory hall. Like a machine builder's marketing
       visualisation.
- 9–10 Near-photographic.

For each image also give the 2–3 biggest things that make it look less real (concrete, actionable:
"bins are saturated toy-red boxes with no lip", not "needs better materials").

Then give:
- an overall score (1–10, your own holistic judgement, not just the mean),
- the top 8 improvements across the whole set, ranked by realism gained per effort,
- anything that looks broken (clipping, floating parts, z-fighting, wrong scale, unreadable labels).

Output format (Markdown):

    ## Scores
    | image | score | biggest problems |
    ...
    ## Overall: N/10
    ## Top improvements
    1. ...
    ## Broken
    - ...

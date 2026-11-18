"""Generate first-pass product parts and a preview render.

Run: blender -b -P tools/blender/parts.py -- <out_dir> [datamatrix.png] [--no-render]
Exports one .glb per asset to <out_dir>/models and, unless --no-render, preview PNGs to <out_dir>.
App models:  blender -b -P tools/blender/parts.py -- public --no-render
Units are metres; pens are ~16 mm diameter, ~150 mm long.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = "--no-render" not in argv
argv = [a for a in argv if a != "--no-render"]
OUT = os.path.abspath(argv[0] if argv else "public")
# Optional sample DataMatrix image (made by tools/scripts/dm-png.mjs) for the preview; the app paints its own at runtime.
DM_PNG = argv[1] if len(argv) > 1 else None
MODELS = os.path.join(OUT, "models")
os.makedirs(MODELS, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metallic=0.0, rough=0.5, alpha=1.0, transmission=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1.0)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    p.inputs["Alpha"].default_value = alpha
    if "Transmission Weight" in p.inputs:
        p.inputs["Transmission Weight"].default_value = transmission
    if alpha < 1.0:
        m.surface_render_method = "BLENDED" if hasattr(m, "surface_render_method") else None
    return m


WHITE = lambda: mat("PenWhite", (0.92, 0.92, 0.9), rough=0.35)
BLUE = lambda: mat("HousingBlue", (0.05, 0.25, 0.7), rough=0.3)
STEEL = lambda: mat("Steel", (0.75, 0.75, 0.78), metallic=1.0, rough=0.25)
GLASS = lambda: mat("Glass", (0.85, 0.95, 1.0), rough=0.05, alpha=0.35, transmission=1.0)
RUBBER = lambda: mat("Rubber", (0.15, 0.15, 0.17), rough=0.8)
ALU = lambda: mat("Alu", (0.8, 0.8, 0.82), metallic=1.0, rough=0.4)
ORANGE = lambda: mat("CapOrange", (0.95, 0.45, 0.05), rough=0.4)
DARK = lambda: mat("MoverDark", (0.12, 0.13, 0.15), rough=0.6)
YELLOW = lambda: mat("MoverTop", (0.95, 0.75, 0.1), rough=0.5)
TRAY = lambda: mat("TrayPET", (0.35, 0.55, 0.75), rough=0.4)
NEST = lambda: mat("NestWhite", (0.95, 0.95, 0.95), rough=0.6)
LIQUID = lambda: mat("Drug", (0.9, 0.85, 0.4), rough=0.1, alpha=0.6)
LABEL = lambda: mat("MoverLabel", (0.97, 0.97, 0.95), rough=0.6)
BASE = lambda: mat("SpringBaseTeal", (0.05, 0.55, 0.5), rough=0.45)
# Pen bodies are frosted translucent plastic, so the spring and cartridge show through.
BODY = lambda: mat("BodyFrost", (0.93, 0.95, 0.97), rough=0.35, alpha=0.5)


def cyl(r, h, z0, m, name, verts=32):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=(0, 0, z0 + h / 2))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


def box(sx, sy, sz, loc, m, name):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    o.name = name
    o.data.materials.append(m)
    return o


def bevel(o, w=0.0008, seg=2):
    b = o.modifiers.new("bevel", "BEVEL")
    b.width = w
    b.segments = seg
    return o


def group(name, parts):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
    return root


# --- Parts (all stand upright along +Z, origin at base centre) ---

def dm_material():
    m = bpy.data.materials.get("DataMatrixMark")
    if m:
        return m
    m = mat("DataMatrixMark", (0.92, 0.92, 0.9), rough=0.5)
    if DM_PNG and os.path.exists(DM_PNG):
        nt = m.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(DM_PNG)
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return m


def cut(target, cutter):
    """Boolean-subtracts cutter from target and deletes the cutter."""
    b = target.modifiers.new("cut", "BOOLEAN")
    b.object = cutter
    b.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(cutter)
    return target


def tube(r_out, r_in, h, z0, m, name, floor=0.0, verts=32):
    """Open-topped tube; `floor` leaves a closed bottom of that thickness."""
    o = cyl(r_out, h, z0, m, name, verts)
    cut(o, cyl(r_in, h, z0 + floor, m, name + "_bore", verts))
    return o


def wrapped_patch(radius, width, height, z_center, name, m, segments=16):
    """A plane bent onto a cylinder surface, facing -Y. UVs span 0..1 so the app can paint a texture on it."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=segments, y_subdivisions=1, size=1)
    o = bpy.context.object
    o.name = name
    r = radius + 0.00005  # sit just proud of the surface to avoid z-fighting
    for v in o.data.vertices:
        u, h = v.co.x * width, v.co.y * height
        a = u / r
        v.co = (r * math.sin(a), -r * math.cos(a), z_center + h)
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


# Geometry along the pen axis matches LINE.parts in src/sim/config.ts: the spring sits in the body
# from 6 mm, the spring base on top of it from 51 mm, the cartridge on that from 57 mm, and the
# housing slides over the body from 8 mm.
# The pen's GS1 DataMatrix is printed on a wrap label on the housing (EM31), facing the inside of
# the loop, centred this high above the housing's base (45 mm above the body's base).
LABEL_Z = 0.037


def pen_body():
    # Open tube with a closed bottom; the spring and cartridge go in from the top.
    core = tube(0.0065, 0.0053, 0.11, 0.0, BODY(), "body_core", floor=0.006)
    flange = cyl(0.0078, 0.004, 0.0, WHITE(), "body_flange")
    return group("PenBody", [core, flange])


def spring(z0=0.0):
    coils, r, wire, h = 12, 0.0042, 0.0006, 0.045
    curve = bpy.data.curves.new("spring_curve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = wire
    curve.bevel_resolution = 3
    sp = curve.splines.new("POLY")
    n = coils * 24
    sp.points.add(n)
    for i in range(n + 1):
        t = i / n
        a = t * coils * 2 * math.pi
        sp.points[i].co = (r * math.cos(a), r * math.sin(a), z0 + t * h, 1)
    o = bpy.data.objects.new("Spring", curve)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(STEEL())
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return o


def spring_base():
    """Seat that caps the spring: a boss into the spring's top coil, a disc that fits the body's
    bore, and a notch the spring's hook engages (what EM15 looks for). 6 mm tall, origin at its base."""
    boss = cyl(0.0034, 0.002, 0.0, BASE(), "base_boss")
    disc = cyl(0.0048, 0.004, 0.002, BASE(), "base_disc")
    cut(disc, box(0.0016, 0.004, 0.0025, (0, -0.0042, 0.003), BASE(), "base_hook_notch"))
    rim = cyl(0.0042, 0.0006, 0.0054, BASE(), "base_rim")
    return group("SpringBase", [boss, disc, rim])


def cartridge():
    glass = cyl(0.0048, 0.065, 0.0, GLASS(), "cart_glass")
    drug = cyl(0.0043, 0.05, 0.006, LIQUID(), "cart_drug")
    stopper = cyl(0.0043, 0.006, 0.0, RUBBER(), "cart_stopper")
    neck = cyl(0.003, 0.004, 0.065, GLASS(), "cart_neck")
    crimp = cyl(0.0042, 0.004, 0.069, ALU(), "cart_crimp")
    return group("Cartridge", [glass, drug, stopper, neck, crimp])


def housing_shell(name):
    """Housing tube that slides over the body."""
    return tube(0.0085, 0.0068, 0.12, 0.0, BLUE(), name, verts=48)


def housing_label(prefix):
    """Wrap label (EM31) with the GS1 DataMatrix patch the app paints the pen's identifier on."""
    paper = wrapped_patch(0.0085, 0.04, 0.026, LABEL_Z, prefix + "_label", LABEL(), segments=24)
    dm = wrapped_patch(0.00856, 0.007, 0.007, LABEL_Z, "dm_label", dm_material())
    return [paper, dm]


def housing():
    shell = housing_shell("housing_shell")
    window = box(0.0035, 0.002, 0.03, (0, -0.0085, 0.085), GLASS(), "housing_window")
    clip = box(0.003, 0.004, 0.035, (0, 0.0095, 0.07), BLUE(), "housing_clip")
    return group("Housing", [shell, window, clip, *housing_label("housing")])


def cap():
    c = cyl(0.009, 0.035, 0.0, ORANGE(), "cap_body", verts=48)
    ring = cyl(0.0092, 0.003, 0.0, ORANGE(), "cap_ring", verts=48)
    return group("Cap", [c, ring])


def assembled_pen():
    """Labelled housing with its cap on, origin at the housing's base (8 mm above the body's base).
    The app draws the body, spring, spring base and cartridge inside it."""
    shell = housing_shell("pen_shell")
    window = box(0.0035, 0.002, 0.03, (0, -0.0085, 0.085), GLASS(), "pen_window")
    clip = box(0.003, 0.004, 0.035, (0, 0.0095, 0.07), BLUE(), "pen_clip")
    c = cyl(0.009, 0.035, 0.12, ORANGE(), "pen_cap", verts=48)
    return group("AssembledPen", [shell, window, clip, c, *housing_label("pen")])




def label_plane(w, h, loc, rot, name):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = (w, h, 1)
    bpy.ops.object.transform_apply(scale=True)
    o.name = name
    o.data.materials.append(LABEL())
    return o


def number_text(num, loc, rot, size, name):
    """Preview-only number; the app paints numbers onto the label_* planes instead."""
    bpy.ops.object.text_add(location=loc, rotation=rot)
    t = bpy.context.object
    t.name = name
    t.data.body = f"{num:02d}"
    t.data.size = size
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.data.extrude = 0.0002
    t.data.materials.append(RUBBER())
    return t


def mover(num=None):
    base = bevel(box(0.12, 0.12, 0.025, (0, 0, 0.0125), DARK(), "mover_base"), 0.004, 3)
    top = bevel(box(0.1, 0.1, 0.004, (0, 0, 0.027), YELLOW(), "mover_top"), 0.002)
    # Socket fixture: the pen stands in a bore (fits the housing) with a lead-in chamfer, on a
    # rubber seat at z = 0.03; a slot at the back locates the housing's clip side.
    fixture = cyl(0.016, 0.026, 0.029, ALU(), "mover_fixture", verts=48)
    cut(fixture, cyl(0.0093, 0.03, 0.03, ALU(), "fixture_bore", verts=48))
    bpy.ops.mesh.primitive_cone_add(radius1=0.0093, radius2=0.0125, depth=0.004, vertices=48, location=(0, 0, 0.0535))
    cut(fixture, bpy.context.object)
    cut(fixture, box(0.004, 0.01, 0.01, (0, 0.013, 0.055), ALU(), "fixture_slot"))
    bevel(fixture, 0.0006)
    hole = cyl(0.0093, 0.001, 0.0292, RUBBER(), "mover_hole")
    # RFID tag on the leading face (+X = direction of travel), read by antennas at each station.
    tag = box(0.004, 0.03, 0.012, (0.061, 0, 0.012), WHITE(), "mover_rfid")
    # Number labels: top (operator view from above) and both long sides.
    lt = label_plane(0.034, 0.018, (0, -0.033, 0.0292), (0, 0, 0), "label_top")
    ls = label_plane(0.04, 0.016, (0, -0.0601, 0.0125), (math.radians(90), 0, 0), "label_side_a")
    lb = label_plane(0.04, 0.016, (0, 0.0601, 0.0125), (math.radians(90), 0, math.radians(180)), "label_side_b")
    parts = [base, top, fixture, hole, tag, lt, ls, lb]
    if num is not None:
        parts += [
            number_text(num, (0, -0.033, 0.0294), (0, 0, 0), 0.016, "num_top"),
            number_text(num, (0, -0.0603, 0.0125), (math.radians(90), 0, 0), 0.014, "num_side_a"),
        ]
    return group("Mover", parts)


def tray(cols=4, rows=3, pitch=0.03):
    w, d = cols * pitch + 0.02, rows * pitch + 0.02
    plate = bevel(box(w, d, 0.006, (0, 0, 0.003), TRAY(), "tray_plate"), 0.002)
    rim = bevel(box(w, d, 0.02, (0, 0, 0.01), TRAY(), "tray_rim"), 0.002)
    cut(rim, box(w - 0.006, d - 0.006, 0.02, (0, 0, 0.016), TRAY(), "tray_cut"))
    # Deep pocket collars hold the pens upright.
    pockets = []
    for i in range(cols):
        for j in range(rows):
            x = (i - (cols - 1) / 2) * pitch
            y = (j - (rows - 1) / 2) * pitch
            pockets.append(tube(0.0125, 0.0095, 0.028, 0.006, TRAY(), f"tray_pocket_{i}_{j}", verts=24))
            pockets[-1].location.x, pockets[-1].location.y = x, y
    return group("Tray", [plate, rim, *pockets])


def nest(cols=6, rows=4, pitch=0.016):
    w, d = cols * pitch + 0.012, rows * pitch + 0.012
    plate = bevel(box(w, d, 0.006, (0, 0, 0.003), NEST(), "nest_plate"), 0.001)
    carts = []
    for i in range(cols):
        for j in range(rows):
            g = cartridge()
            g.location = ((i - (cols - 1) / 2) * pitch, (j - (rows - 1) / 2) * pitch, 0.006)
            carts.append(g)
    root = group("CartridgeNest", [plate])
    for c in carts:
        c.parent = root
    return root


def export(root, filename):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for c in root.children_recursive:
        c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, filename), use_selection=True, export_apply=True)


# --- Build, export, and lay out a contact sheet ---

reset()
assets = [
    (pen_body(), "pen_body.glb", "Pen body"),
    (group("SpringRoot", [spring()]), "spring.glb", "Spring"),
    (spring_base(), "spring_base.glb", "Spring base"),
    (cartridge(), "cartridge.glb", "Cartridge"),
    (housing(), "housing.glb", "Housing"),
    (cap(), "cap.glb", "Cap"),
    (assembled_pen(), "pen.glb", "Assembled pen"),
    (mover(), "mover.glb", "Mover"),
    (tray(), "tray.glb", "Tray 3x4"),
    (nest(), "nest.glb", "Nest 24"),
]
for root, fn, _ in assets:
    export(root, fn)

if not RENDER:
    print("DONE (models only)", MODELS)
    sys.exit(0)

# Lay out in a row for the preview; small parts up front, carriers behind.
small = assets[:7]
big = assets[7:]
for i, (root, _, label) in enumerate(small):
    root.location = ((i - 3) * 0.045, 0.0, 0.0)
for i, (root, _, label) in enumerate(big):
    root.location = ((i - 1) * 0.16, 0.15, 0.0)
# Put a pen in the mover and on the tray to show fit.
demo = assembled_pen()
demo.location = big[0][0].location + Vector((0, 0, 0.038))  # seat 0.03 + housing offset 0.008
demo_body = pen_body()
demo_body.location = big[0][0].location + Vector((0, 0, 0.03))

for root, _, label in assets:
    bpy.ops.object.text_add(location=(root.location.x, root.location.y - 0.03 - (0.05 if root in [a[0] for a in big] else 0), 0.0))
    t = bpy.context.object
    t.data.body = label
    t.data.size = 0.008 if root in [a[0] for a in small] else 0.012
    t.data.align_x = "CENTER"
    t.data.materials.append(RUBBER())

# Floor, lights, camera
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.0005))
bpy.context.object.data.materials.append(mat("Floor", (0.6, 0.62, 0.65), rough=0.7))

bpy.ops.object.light_add(type="AREA", location=(0.2, -0.4, 0.6))
key = bpy.context.object
key.data.energy = 6
key.data.size = 0.8
key.rotation_euler = (math.radians(40), 0, math.radians(20))
bpy.ops.object.light_add(type="SUN", location=(0, 0, 1))
bpy.context.object.data.energy = 1.2
bpy.context.object.rotation_euler = (math.radians(30), math.radians(-25), 0)

scene = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.8, 0.82, 0.85, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
transforms = [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items]
scene.view_settings.view_transform = "AgX" if "AgX" in transforms else "Standard"


def shot(loc, target, lens, filename, w=1600, h=900):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    cam.data.clip_start = 0.001
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(OUT, filename)
    bpy.ops.render.render(write_still=True)


# Overview of all parts.
shot((0.0, -0.62, 0.42), (0.0, 0.08, 0.02), 50, "preview.png")

# Close-up: numbered movers in a queue, carrying pen bodies with DataMatrix marks.
for i, n in enumerate([7, 8, 9]):
    m = mover(n)
    m.location = (0.5 + i * 0.15, 0.6, 0.0)
    b = pen_body()
    b.location = m.location + Vector((0, 0, 0.03))
    b.rotation_euler.z = math.radians(-10)
lone = pen_body()
lone.location = (0.43, 0.47, 0.0)
bpy.ops.object.light_add(type="AREA", location=(0.65, 0.25, 0.35))
fill = bpy.context.object
fill.data.energy = 3
fill.data.size = 0.5
fill.rotation_euler = (math.radians(50), 0, 0)
shot((0.5, 0.22, 0.2), (0.6, 0.58, 0.05), 38, "preview-closeup.png")

print("DONE", OUT)

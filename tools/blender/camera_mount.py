"""Monitoring camera on its post: the mount for the fixed station cameras (src/view/cameras.ts).

Run: blender -b -P tools/blender/camera_mount.py -- <out_dir> [--no-render]
Exports <out_dir>/models/camera_mount.glb and, unless --no-render, <out_dir>/camera-mount-preview.png.
App model:  blender -b -P tools/blender/camera_mount.py -- public --no-render

A compact machine-vision camera (40 mm cube body, C-mount lens) on a ball head, clamped on a 20 mm
aluminium profile that stands on a foot plate bolted to the table. The app builds each mount from
four parts, so one model fits every camera height and aim:

- cam_head: camera, bracket and ball. Origin at the optical centre, looking along +Y (three.js -Z,
  like a three.js camera), so the app gives it the station camera's pose as is. Everything lies
  behind the optical centre, so the camera can't see its own lens or body. Two empties mark where the
  app attaches the rest: cam_pivot (centre of the ball) and cam_cable (end of the cable connector).
- cam_clamp: the profile clamp with the ball socket; origin at the ball's centre. The empty
  cam_post_top marks where the post ends inside it.
- cam_post: the profile, 1 m tall with its origin at the bottom; the app scales it to length.
- cam_foot: foot plate with angle brackets; origin at the bottom, on the table. The empty
  cam_post_base marks where the post stands. The plate reaches forward (+Y, toward the camera's
  view) more than back, so it stays clear of the belt behind a camera.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import bevel, box, cut, cyl, export, group, mat, reset  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = "--no-render" not in argv
argv = [a for a in argv if a != "--no-render"]
OUT = os.path.abspath(argv[0] if argv else "public")

BODY = lambda: mat("CamBody", (0.42, 0.45, 0.5), metallic=0.8, rough=0.38)
BLACK = lambda: mat("CamBlack", (0.025, 0.025, 0.03), metallic=0.5, rough=0.35)
RUBBER = lambda: mat("CamRubber", (0.04, 0.04, 0.045), rough=0.85)
GLASS = lambda: mat("CamGlass", (0.05, 0.035, 0.11), metallic=0.9, rough=0.03)
CHROME = lambda: mat("CamChrome", (0.8, 0.8, 0.82), metallic=1.0, rough=0.18)
ALU = lambda: mat("ProfileAlu", (0.78, 0.79, 0.81), metallic=1.0, rough=0.42)
STEEL = lambda: mat("FootSteel", (0.2, 0.22, 0.25), metallic=0.6, rough=0.5)
LABEL = lambda: mat("CamLabel", (0.82, 0.83, 0.8), rough=0.6)
LED = lambda: mat("CamLed", (0.1, 0.8, 0.2), emission=(0.2, 1.0, 0.3), strength=4.0)
LED_AMBER = lambda: mat("CamLedAmber", (0.9, 0.5, 0.05), emission=(1.0, 0.55, 0.05), strength=2.5)

# Camera geometry (Blender axes: X right, Y forward along the lens, Z up; optical centre at 0).
LENS_R = 0.0145
LENS_FRONT = -0.0015
LENS_BACK = -0.032
BODY_S = 0.04
BODY_FRONT = LENS_BACK - 0.002
BODY_BACK = BODY_FRONT - BODY_S
# Ball head under the lens/body joint: as far forward as the bracket allows, so the post stands
# clear of the belt behind cameras that sit close to the other side of the loop.
PIVOT = (0.0, -0.02, -0.036)
BALL_R = 0.006
POST = 0.02
# Ball centre down to the bottom of the clamp block.
CLAMP_DEPTH = BALL_R * 0.6 + 0.008 + 0.024


def ycyl(r, y0, y1, m, name, x=0.0, z=0.0, verts=48):
    """Cylinder along Y from y0 to y1."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=abs(y1 - y0), vertices=verts, location=(x, (y0 + y1) / 2, z), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


def xcyl(r, x0, x1, m, name, y=0.0, z=0.0, verts=24):
    """Cylinder along X from x0 to x1."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=abs(x1 - x0), vertices=verts, location=((x0 + x1) / 2, y, z), rotation=(0, math.pi / 2, 0))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


def at(o, x=0.0, y=0.0, z=0.0):
    o.location = Vector((x, y, z)) + o.location
    return o


def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def merge(name, parts):
    """Joins meshes into one object (one draw per material), with their modifiers applied."""
    meshes = [apply_mods(o) for o in parts if o.type == "MESH"]
    others = [o for o in parts if o.type != "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    meshes[0].name = name
    return [meshes[0], *others]


def empty(name, loc):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    bpy.context.scene.collection.objects.link(o)
    return o


def head():
    parts = []
    # Lens: front bezel with the glass set back in it, focus and aperture rings, C-mount thread.
    bezel = ycyl(LENS_R, LENS_FRONT - 0.004, LENS_FRONT, BLACK(), "lens_bezel")
    cut(bezel, ycyl(0.0108, LENS_FRONT - 0.0025, LENS_FRONT + 0.001, BLACK(), "lens_recess"))
    parts += [
        bezel,
        ycyl(0.0108, LENS_FRONT - 0.0028, LENS_FRONT - 0.0024, GLASS(), "lens_glass"),
        ycyl(LENS_R - 0.0008, LENS_BACK, LENS_FRONT - 0.004, BLACK(), "lens_barrel"),
        ycyl(LENS_R + 0.0008, -0.021, -0.011, RUBBER(), "lens_focus", verts=24),
        ycyl(LENS_R + 0.0003, -0.027, -0.0235, CHROME(), "lens_aperture"),
        ycyl(0.0125, BODY_FRONT, LENS_BACK, CHROME(), "lens_mount"),
    ]
    # Knurl on the focus ring.
    for i in range(24):
        a = i / 24 * 2 * math.pi
        k = box(0.0012, 0.0098, 0.0012, (math.cos(a) * (LENS_R + 0.0012), -0.016, math.sin(a) * (LENS_R + 0.0012)), RUBBER(), f"lens_knurl_{i}")
        k.rotation_euler.y = -a
        parts.append(k)

    # Body: anodised cube with a black front plate, cooling grooves, a type label and status LEDs.
    yc = (BODY_FRONT + BODY_BACK) / 2
    body = apply_mods(bevel(box(BODY_S, BODY_S - 0.004, BODY_S, (0, yc - 0.001, 0), BODY(), "cam_body"), 0.0015, 2))
    for s in (-1, 1):
        for i, z in enumerate((-0.01, 0.0, 0.01)):
            cut(body, box(0.002, 0.026, 0.0022, (s * BODY_S / 2, yc - 0.004, z), BODY(), f"cam_groove_{s}_{i}"))
    front = bevel(box(BODY_S, 0.004, BODY_S, (0, BODY_FRONT - 0.002, 0), BLACK(), "cam_front"), 0.0015, 2)
    back = bevel(box(BODY_S - 0.002, 0.003, BODY_S - 0.002, (0, BODY_BACK + 0.0005, 0), BLACK(), "cam_back"), 0.001, 2)
    label = box(0.0005, 0.016, 0.009, (BODY_S / 2 + 0.0002, yc + 0.006, 0.013), LABEL(), "cam_label")
    leds = [ycyl(0.0009, BODY_BACK - 0.0012, BODY_BACK, m, f"cam_led_{i}", x=0.014 - i * 0.004, z=0.0145, verts=12) for i, m in enumerate((LED(), LED_AMBER()))]
    parts += [body, front, back, label, *leds]

    # M12 connector under the back of the body, pointing down (the body's back stays compact, clear
    # of the pens passing on the belt behind cameras near the other side of the loop). The app runs
    # the cable from its end.
    cy, bottom = BODY_BACK + 0.008, -BODY_S / 2
    parts += [
        at(cyl(0.0055, 0.005, bottom - 0.005, CHROME(), "cable_nut", 6), 0, cy),
        at(cyl(0.0055, 0.011, bottom - 0.016, RUBBER(), "cable_plug", 20), 0, cy),
        at(cyl(0.0042, 0.008, bottom - 0.024, RUBBER(), "cable_boot", 20), 0, cy),
    ]
    cable_end = (0.0, cy, bottom - 0.024)

    # Bracket: a plate under the body that reaches forward under the lens, a saddle that holds the
    # lens, and the ball the clamp grips.
    px, py, pz = PIVOT
    plate_top = -BODY_S / 2
    plate_y0, plate_y1 = BODY_BACK + 0.016, -0.012
    parts += [
        bevel(box(0.03, plate_y1 - plate_y0, 0.006, (0, (plate_y0 + plate_y1) / 2, plate_top - 0.003), STEEL(), "bracket_plate"), 0.0008, 2),
        bevel(box(0.012, 0.008, plate_top + 0.0005 + LENS_R, (0, py, (plate_top - LENS_R + 0.0005) / 2), STEEL(), "bracket_saddle"), 0.0006, 2),
        at(cyl(0.0035, plate_top - 0.006 - pz, pz, BLACK(), "ball_stem", 20), px, py),
    ]
    bpy.ops.mesh.primitive_uv_sphere_add(radius=BALL_R, segments=24, ring_count=12, location=PIVOT)
    ball = bpy.context.object
    ball.name = "ball"
    ball.data.materials.append(BLACK())
    bpy.ops.object.shade_smooth()
    parts.append(ball)

    return group("cam_head", [*merge("camera", parts), empty("cam_pivot", PIVOT), empty("cam_cable", cable_end)])


def clamp():
    """Profile clamp with the ball socket on top and a locking knob; origin at the ball's centre."""
    socket = cyl(0.0095, 0.008, -BALL_R * 0.6 - 0.008, BLACK(), "clamp_socket", 32)
    block = bevel(box(POST + 0.008, POST + 0.008, 0.024, (0, 0, -BALL_R * 0.6 - 0.008 - 0.012), BLACK(), "clamp_block"), 0.0015, 2)
    screw = xcyl(0.0025, POST / 2 + 0.004, POST / 2 + 0.012, CHROME(), "clamp_screw", z=-BALL_R * 0.6 - 0.02)
    knob = xcyl(0.0055, POST / 2 + 0.012, POST / 2 + 0.016, RUBBER(), "clamp_knob", z=-BALL_R * 0.6 - 0.02, verts=10)
    lock = xcyl(0.0018, 0.0085, 0.014, CHROME(), "socket_screw", z=-BALL_R * 0.6 - 0.004, verts=12)
    face = (POST + 0.008) / 2
    screws = [
        ycyl(0.0021, s * face, s * (face + 0.0012), CHROME(), f"clamp_cap_{s}_{x}", x=x, z=-BALL_R * 0.6 - 0.008 - 0.017, verts=16)
        for s in (-1, 1)
        for x in (-0.0075, 0.0075)
    ]
    # Where the post's top ends, inside the clamp block.
    post_top = empty("cam_post_top", (0, 0, -CLAMP_DEPTH + 0.01))
    return group("cam_clamp", [*merge("clamp", [socket, block, screw, knob, lock, *screws]), post_top])


def post():
    """20 mm slot profile, 1 m tall: four T-slots and a centre bore."""
    o = box(POST, POST, 1.0, (0, 0, 0.5), ALU(), "post_profile")
    for i in range(4):
        a = i * math.pi / 2
        dx, dy = math.cos(a), math.sin(a)
        neck = box(0.006 if dy else 0.008, 0.008 if dy else 0.006, 1.02, (dx * POST / 2, dy * POST / 2, 0.5), ALU(), f"slot_neck_{i}")
        cut(o, neck)
        inner = box(0.012 if dy else 0.004, 0.004 if dy else 0.012, 1.02, (dx * (POST / 2 - 0.005), dy * (POST / 2 - 0.005), 0.5), ALU(), f"slot_inner_{i}")
        cut(o, inner)
    cut(o, cyl(0.0021, 1.02, -0.01, ALU(), "post_bore", 16))
    return group("cam_post", [o])


FOOT_T = 0.008
FOOT_BACK = 0.0165
FOOT_FRONT = 0.032
# Cable centre behind the post (cameramounts.ts: half the post plus the cable radius).
GLAND_Y = POST / 2 + 0.0025


def foot():
    """Foot plate bolted to the table, with an angle bracket on each side of the post."""
    w = 0.048  # narrow enough to clear EM50's side reader next to the springbase camera
    plate = bevel(box(w, FOOT_BACK + FOOT_FRONT, FOOT_T, (0, (FOOT_FRONT - FOOT_BACK) / 2, FOOT_T / 2), STEEL(), "foot_plate"), 0.001, 2)
    parts = [plate]
    for s in (-1, 1):
        parts += [
            box(0.003, 0.016, 0.02, (s * (POST / 2 + 0.0015), 0, FOOT_T + 0.01), STEEL(), f"foot_angle_v_{s}"),
            box(0.012, 0.016, 0.003, (s * (POST / 2 + 0.006), 0, FOOT_T + 0.0015), STEEL(), f"foot_angle_h_{s}"),
            at(cyl(0.0032, 0.003, FOOT_T + 0.003, CHROME(), f"foot_bolt_angle_{s}", 16), s * (POST / 2 + 0.0075)),
        ]
        # Cap screws into the table, sunk in counterbores at the plate's corners.
        for y in (-FOOT_BACK + 0.0055, FOOT_FRONT - 0.0055):
            x = s * (w / 2 - 0.0055)
            cut(plate, at(cyl(0.0034, 0.004, FOOT_T - 0.0025, STEEL(), f"foot_cbore_{s}_{y}", 20), x, y))
            parts += [
                at(cyl(0.0027, 0.0024, FOOT_T - 0.0025, RUBBER(), f"foot_screw_{s}_{y}", 20), x, y),
                at(cyl(0.0012, 0.0012, FOOT_T - 0.0005, STEEL(), f"foot_hex_{s}_{y}", 6), x, y),
            ]
    # Cable gland behind the post, where the camera cable goes through the plate into the table.
    parts += [
        at(cyl(0.0041, 0.0022, FOOT_T, CHROME(), "gland_nut", 6), 0, -GLAND_Y),
        at(cyl(0.0036, 0.0035, FOOT_T + 0.0022, RUBBER(), "gland_seal", 20), 0, -GLAND_Y),
    ]
    return group("cam_foot", [*merge("foot", parts), empty("cam_post_base", (0, 0, FOOT_T))])


reset()
h, c, p, f = head(), clamp(), post(), foot()
root = group("CameraMount", [h, c, p, f])
export(root, os.path.join(OUT, "models", "camera_mount.glb"))

if not RENDER:
    print("DONE (models only)", OUT)
    sys.exit(0)

# Preview: the parts assembled as the app does, the post cut to a station camera's height.
eye_z = 0.23  # optical centre above the table (the station cameras are 0.17 m above the belt)
h.location = (0, 0, eye_z)
h.rotation_euler = (math.radians(-6), 0, 0)
bpy.context.view_layer.update()
pivot = h.matrix_world @ Vector(PIVOT)
c.location = pivot
post_top = pivot.z - CLAMP_DEPTH + 0.01
p.location = (pivot.x, pivot.y, FOOT_T)
p.scale = (1, 1, post_top - FOOT_T)
f.location = (pivot.x, pivot.y, 0)

bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
bpy.context.object.data.materials.append(mat("Table", (0.3, 0.33, 0.38), rough=0.8))
bpy.ops.object.light_add(type="AREA", location=(0.3, 0.4, 0.6))
key = bpy.context.object
key.data.energy = 12
key.data.size = 0.6
key.rotation_euler = (math.radians(-35), math.radians(25), 0)
bpy.ops.object.light_add(type="SUN", location=(0, 0, 1))
bpy.context.object.data.energy = 2.0
bpy.context.object.rotation_euler = (math.radians(35), math.radians(-30), math.radians(30))

scene = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.8, 0.82, 0.85, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
transforms = [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items]
scene.view_settings.view_transform = "AgX" if "AgX" in transforms else "Standard"

bpy.ops.object.camera_add(location=(0.36, 0.3, 0.34))
cam = bpy.context.object
cam.rotation_euler = (Vector((0, -0.015, 0.125)) - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 50
cam.data.clip_start = 0.001
scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = 1200, 1200
scene.render.filepath = os.path.join(OUT, "camera-mount-preview.png")
bpy.ops.render.render(write_still=True)
print("DONE", OUT)

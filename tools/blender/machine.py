"""Millimetre-scale machine hardware. Run blender -b -P tools/blender/machine.py.
The catalogue contains named, origin-centred assemblies. The view places and
scales them against the simulation's station geometry. Dimensions below are in
metres, expressed in the view's X/right, Y/up, Z/towards-operator frame.
"""

import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)


def finish(name, rgb, metal, rough):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bs = mat.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (*rgb, 1)
    bs.inputs["Metallic"].default_value = metal
    bs.inputs["Roughness"].default_value = rough
    return mat


alu = finish("Bead blasted aluminium", (0.55, 0.58, 0.58), 0.92, 0.3)
steel = finish("Ground steel", (0.56, 0.59, 0.60), 0.95, 0.21)
dark = finish("Graphite anodising", (0.042, 0.055, 0.058), 0.68, 0.34)
seal = finish("Black elastomer", (0.012, 0.015, 0.016), 0.0, 0.56)
paint = finish("Mineral enamel", (0.57, 0.60, 0.57), 0.0, 0.4)
blue = finish("Air coupling", (0.032, 0.19, 0.25), 0.0, 0.34)
poly = finish("Conductive polypropylene", (0.096, 0.15, 0.17), 0.07, 0.4)
items = []


def point(x, y, z):
    return Vector((x, -z, y))


def part(mesh, material, bevel=0):
    if bevel:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
        bm.to_mesh(mesh)
        bm.free()
    obj = bpy.data.objects.new("component", mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    items.append(obj)
    return obj


def mesh(verts, faces, mat, bevel=0):
    data = bpy.data.meshes.new("component")
    data.from_pydata([point(*p) for p in verts], [], faces)
    data.update()
    # Rings are defined in drafting order. Orient closed components consistently.
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    return part(data, mat, bevel)


def prism(section, y0, y1, mat, bevel=0):
    n = len(section)
    verts = [(x, y, z) for y in (y0, y1) for x, z in section]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh(verts, faces, mat, bevel)


def block(x, y, z, w, h, d, mat, bevel=0.0007):
    return prism(
        [(x - w / 2, z - d / 2), (x + w / 2, z - d / 2), (x + w / 2, z + d / 2), (x - w / 2, z + d / 2)],
        y - h / 2,
        y + h / 2,
        mat,
        min(bevel, min(w, h, d) * 0.18),
    )


def roundbar(x, y, z, r, h, mat, n=24, axis="y"):
    obj = prism(
        [(r * math.cos(i * math.tau / n), r * math.sin(i * math.tau / n)) for i in range(n)],
        -h / 2,
        h / 2,
        mat,
    )
    obj.location = point(x, y, z)
    if axis == "x":
        obj.rotation_euler.y = math.pi / 2
    elif axis == "z":
        obj.rotation_euler.x = math.pi / 2
    for face in list(obj.data.polygons)[2:]:
        face.use_smooth = n >= 16
    return obj


def screws(xs, zs, y, radius=0.0032):
    for x in xs:
        for z in zs:
            roundbar(x, y, z, radius, 0.0016, steel, 16)
            roundbar(x, y + 0.00085, z, radius * 0.54, 0.0002, seal, 6)


def quad(x, y, z, w, h, facing, material):
    """UV-mapped rectangle (0..1) facing +x/-x/+y/+z/-z, for printed plates the app paints."""
    hw, hh = w / 2, h / 2
    if facing == "+z":
        corners = [(x - hw, y - hh, z), (x + hw, y - hh, z), (x + hw, y + hh, z), (x - hw, y + hh, z)]
    elif facing == "-z":
        corners = [(x + hw, y - hh, z), (x - hw, y - hh, z), (x - hw, y + hh, z), (x + hw, y + hh, z)]
    elif facing == "+x":
        corners = [(x, y - hh, z + hw), (x, y - hh, z - hw), (x, y + hh, z - hw), (x, y + hh, z + hw)]
    elif facing == "-x":
        corners = [(x, y - hh, z - hw), (x, y - hh, z + hw), (x, y + hh, z + hw), (x, y + hh, z - hw)]
    else:
        corners = [(x - hw, y, z + hh), (x + hw, y, z + hh), (x + hw, y, z - hh), (x - hw, y, z - hh)]
    data = bpy.data.meshes.new("component")
    data.from_pydata([point(*c) for c in corners], [], [(0, 1, 2, 3)])
    uv = data.uv_layers.new()
    for loop, (u, v) in zip(data.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[loop.index].uv = (u, v)
    return part(data, material)


def save(name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in items:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = items[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = name
    items.clear()


# 40 series profile with undercut longitudinal slots on all four sides.
section = []
for side in range(4):
    a = side * math.pi / 2
    for x, z in [
        (-0.018, -0.02),
        (-0.0035, -0.02),
        (-0.0035, -0.017),
        (-0.0063, -0.017),
        (-0.0063, -0.014),
        (-0.003, -0.0115),
        (0.003, -0.0115),
        (0.0063, -0.014),
        (0.0063, -0.017),
        (0.0035, -0.017),
        (0.0035, -0.02),
        (0.018, -0.02),
    ]:
        section.append((x * math.cos(a) - z * math.sin(a), x * math.sin(a) + z * math.cos(a)))
extrusion = prism(section, 0, 1, alu)
extrusion.data.materials.append(dark)
for face in extrusion.data.polygons:
    # Unlit root of each undercut; the four visible outer lands stay bright.
    centre = face.center
    if len(face.vertices) == 4 and max(abs(centre.x), abs(centre.y)) < 0.016:
        face.material_index = 1
save("Profile40")

# Flanged column shoe and diagonal cast gussets.
block(0, 0.004, 0, 0.08, 0.008, 0.078, dark, 0.002)
for s in (-1, 1):
    obj = prism(
        [
            (0.018 * s, -0.014),
            (0.037 * s, -0.014),
            (0.037 * s, -0.010),
            (0.023 * s, 0.031),
            (0.018 * s, 0.031),
        ],
        -0.014,
        0.014,
        alu,
    )
    obj.rotation_euler.x = math.pi / 2
    obj.location.z = 0.021
screws([-0.032, 0.032], [-0.029, 0.029], 0.0088)
save("ColumnShoe")

# Servo motor: square flange with bolt heads, ribbed black body, rounded encoder
# cover, angled power and feedback plugs with cable tails, silver rating plate.
# Axis along +X from the flange face at x = 0.
nameplate = finish("Motor nameplate", (0.62, 0.64, 0.64), 0.4, 0.42)
block(0.001, 0, 0, 0.008, 0.05, 0.05, alu, 0.0018)
for y in (-0.019, 0.019):
    for z in (-0.019, 0.019):
        roundbar(-0.0035, y, z, 0.0032, 0.0012, steel, 12, "x")
        roundbar(-0.0042, y, z, 0.0017, 0.0003, seal, 6, "x")
block(0.034, 0, 0, 0.058, 0.044, 0.044, dark, 0.003)
for side in (-1, 1):
    for k in (-1, 0, 1):
        block(0.033, k * 0.012, side * 0.0226, 0.046, 0.0026, 0.0018, dark, 0.0005)
block(0.07, 0, 0, 0.016, 0.041, 0.041, seal, 0.006)
block(0.0785, 0, 0, 0.002, 0.03, 0.03, dark, 0.001)
for x, r, h in ((0.05, 0.0072, 0.016), (0.066, 0.0055, 0.013)):
    block(x, 0.024, 0, 0.016 if r > 0.006 else 0.012, 0.005, 0.018 if r > 0.006 else 0.014, alu, 0.001)
    roundbar(x, 0.0265 + h / 2, 0, r, h, seal, 20)
    roundbar(x, 0.031, 0, r + 0.0008, 0.004, steel, 20)
    tail = roundbar(x + 0.014, 0.0265 + h - 0.003, 0, r * 0.8, 0.026, seal, 16, "x")
quad(0.03, -0.001, 0.0222, 0.036, 0.022, "+z", nameplate)
save("Servo")

# Guided pneumatic slide. Two end plates, tie rods, air fittings and wiper.
block(0, 0.068, 0, 0.053, 0.112, 0.046, alu, 0.004)
for y in (0.01, 0.127):
    block(0, y, 0, 0.06, 0.018, 0.052, dark, 0.002)
for x in (-0.025, 0.025):
    for z in (-0.022, 0.022):
        roundbar(x, 0.068, z, 0.003, 0.119, steel, 12)
for y in (0.027, 0.113):
    roundbar(0.029, y, 0, 0.005, 0.012, steel, 12, "x")
    roundbar(0.037, y, 0, 0.0055, 0.006, blue, 16, "x")
roundbar(0, -0.001, 0, 0.017, 0.006, seal)
screws([-0.024, 0.024], [-0.019, 0.019], 0.137)
save("Cylinder")

# Parallel gripper: anodised body with guide cover, piston cap, air ports and a
# sensor slot; jaws travel along Z. Origin: tool flange centre at the top.
block(0, 0.033, 0, 0.038, 0.024, 0.03, alu, 0.0022)
block(0, 0.0195, 0, 0.034, 0.005, 0.032, dark, 0.0008)
block(0, 0.033, 0.0152, 0.028, 0.012, 0.0009, dark, 0.0003)
roundbar(0, 0.047, 0, 0.012, 0.006, dark, 24)
roundbar(0, 0.0515, 0, 0.0085, 0.003, alu, 24)
for x in (-0.012, 0.012):
    roundbar(x, 0.0337, -0.0156, 0.0028, 0.0018, steel, 12, "z")
    roundbar(x, 0.0337, -0.0168, 0.0031, 0.0016, blue, 16, "z")
for x in (-0.013, 0.013):
    for z in (-0.009, 0.009):
        roundbar(x, 0.0452, z, 0.0017, 0.0008, steel, 10)
save("JawBody")

# Gripper finger: mounting step bolted to the jaw, slim blade with a V-notch on
# the gripping face (-Z). Origin: jaw face centre; the blade hangs down -Y.
mesh(
    [(x, y, z) for x in (-0.0045, 0.0045) for y, z in [(0.019, 0.0), (0.019, 0.006), (0.004, 0.006), (0.004, 0.003), (-0.024, 0.003), (-0.024, 0.0)]],
    [(0, 1, 2, 3, 4, 5), (6, 7, 8, 9, 10, 11)] + [(i, (i + 1) % 6, 6 + (i + 1) % 6, 6 + i) for i in range(6)],
    steel,
    0.0004,
)
# One finish per finger (each finger is its own draw): the grip insert and screw heads are
# machined in the same steel.
block(0, -0.014, -0.0004, 0.004, 0.016, 0.0012, steel, 0.0002)
for y in (0.009, 0.015):
    roundbar(0, y, 0.0063, 0.0016, 0.0007, steel, 10, "z")
save("Finger")

# Machine vision camera looking down -Y: finned housing, M12 plug and cable,
# lens barrel with knurled focus and iris rings, and a ring light whose
# diffuser the app lights while the camera exposes. Origin: housing centre.
ring_light = finish("Ring light", (0.92, 0.95, 0.96), 0.0, 0.3)
lens = finish("Lens glass", (0.01, 0.012, 0.016), 0.9, 0.06)
block(0, 0.002, 0, 0.044, 0.056, 0.044, dark, 0.0025)
for i in range(6):
    block(0, 0.008 + i * 0.0042, 0, 0.0475, 0.0016, 0.0475, alu, 0.0004)
block(0, -0.029, 0, 0.048, 0.006, 0.048, alu, 0.0012)
roundbar(0, 0.0335, 0, 0.0065, 0.008, steel, 20)
roundbar(0, 0.041, 0, 0.0052, 0.008, seal, 16)
block(0.0221, 0.004, 0.012, 0.0008, 0.003, 0.003, finish("Status green", (0.05, 0.7, 0.2), 0, 0.3))
roundbar(0, -0.043, 0, 0.0145, 0.022, dark, 32)
for y, m in ((-0.04, steel), (-0.05, seal)):
    roundbar(0, y, 0, 0.0156, 0.006, m, 32)
roundbar(0, -0.0545, 0, 0.0115, 0.0014, lens, 32)
ring = prism(
    [(0.035 * math.cos(i * math.tau / 40), 0.035 * math.sin(i * math.tau / 40)) for i in range(40)],
    -0.07,
    -0.058,
    dark,
    0.001,
)
cut_r = roundbar(0, -0.064, 0, 0.0175, 0.02, dark, 32)
bool_ = ring.modifiers.new("bore", "BOOLEAN")
bool_.operation = "DIFFERENCE"
bool_.object = cut_r
bpy.context.view_layer.objects.active = ring
bpy.ops.object.modifier_apply(modifier=bool_.name)
items.remove(cut_r)
bpy.data.objects.remove(cut_r, do_unlink=True)
diffuser = prism(
    [(0.0325 * math.cos(i * math.tau / 40), 0.0325 * math.sin(i * math.tau / 40)) for i in range(40)],
    -0.0712,
    -0.0702,
    ring_light,
)
cut_d = roundbar(0, -0.0707, 0, 0.0195, 0.004, ring_light, 32)
bool_ = diffuser.modifiers.new("bore", "BOOLEAN")
bool_.operation = "DIFFERENCE"
bool_.object = cut_d
bpy.context.view_layer.objects.active = diffuser
bpy.ops.object.modifier_apply(modifier=bool_.name)
items.remove(cut_d)
bpy.data.objects.remove(cut_d, do_unlink=True)
for i in range(3):
    a = i * math.tau / 3 + 0.5
    block(0.024 * math.cos(a), -0.0525, 0.024 * math.sin(a), 0.004, 0.011, 0.004, dark, 0.0005)
save("VisionCamera")

# Cast C standard of a press module: a closed column with a chamfered back,
# the press head arm and a foot, in white enamel with a machined cover over the
# throat face, bolted side covers and panel joints. Extruded side silhouette.
def casting(points, half, material, bevel=0.002):
    verts = [(x, y, z) for x in (-half, half) for z, y in points]
    n = len(points)
    faces = [tuple(range(n)), tuple(range(n, n * 2))] + [
        (i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)
    ]
    mesh(verts, faces, material, bevel)


white = finish("Press enamel", (0.74, 0.75, 0.72), 0.0, 0.36)
joint = finish("Panel joint", (0.3, 0.31, 0.3), 0.0, 0.6)
casting(
    [
        (-0.058, 0.012),
        (0.069, 0.012),
        (0.069, 0.03),
        (0.024, 0.042),
        (-0.004, 0.068),
        (-0.004, 0.39),
        (0.012, 0.414),
        (0.066, 0.43),
        (0.066, 0.486),
        (-0.046, 0.486),
        (-0.058, 0.472),
    ],
    0.032,
    white,
    0.0035,
)
# Throat cover with countersunk screws, and the guarded slot of the head arm.
block(0, 0.229, -0.0028, 0.05, 0.3, 0.0026, alu, 0.0009)
for y in (0.088, 0.37):
    for x in (-0.019, 0.019):
        roundbar(x, y, -0.0012, 0.0022, 0.0009, steel, 12, "z")
block(0, 0.4555, 0.0668, 0.046, 0.04, 0.0016, alu, 0.0006)
for s_ in (-1, 1):
    x = s_ * 0.0322
    # Bolted side cover and two panel joints on each cheek.
    block(x + s_ * 0.0005, 0.155, -0.031, 0.0012, 0.11, 0.042, alu, 0.0004)
    for y in (0.106, 0.204):
        for z in (-0.047, -0.015):
            roundbar(x + s_ * 0.0012, y, z, 0.0018, 0.0008, steel, 10, "x")
    for y in (0.262, 0.35):
        block(x + s_ * 0.0002, y, -0.031, 0.0006, 0.001, 0.054, joint)
block(0, 0.006, 0, 0.106, 0.012, 0.154, dark, 0.003)
screws([-0.044, 0.044], [-0.064, 0.064], 0.013)
save("PressStandard")

# Guide rail holder. A foot clamped to the side profile's top slot carries the
# round rail by a threaded stem into its outboard face, so nothing rises above
# the rail's crown (the carriers' side ID plates stay in view). Origin: rail
# axis plan position at belt height; the rail axis is 5 mm up, +Z is outboard.
block(0, -0.0045, 0.012, 0.017, 0.005, 0.03, dark, 0.0008)
block(0, 0.0024, 0.0118, 0.017, 0.0124, 0.0072, dark, 0.0009)
roundbar(0, 0.005, 0.0064, 0.0024, 0.0044, steel, 12, "z")
roundbar(0, 0.0036, 0.0161, 0.0029, 0.0016, steel, 16, "z")
roundbar(0, 0.0036, 0.017, 0.0015, 0.0003, seal, 6, "z")
roundbar(0, -0.0016, 0.0215, 0.0029, 0.0013, steel, 16)
roundbar(0, -0.0009, 0.0215, 0.0015, 0.0002, seal, 6)
save("GuideClip")

# Pneumatic pallet stopper in the conveyor's centre channel, below the belt
# plane. Origin: stop face centre on the belt surface. The head is separate.
block(0, -0.047, 0, 0.034, 0.066, 0.03, dark, 0.0015)
block(0, -0.0105, 0, 0.04, 0.007, 0.036, alu, 0.0008)
roundbar(0, -0.088, 0, 0.012, 0.016, alu, 24)
roundbar(0, -0.0975, 0, 0.0085, 0.003, dark, 24)
for x in (-0.014, 0.014):
    for z in (-0.013, 0.013):
        roundbar(x, -0.0068, z, 0.0021, 0.0008, steel, 12)
for y in (-0.03, -0.06):
    roundbar(0.019, y, 0.006, 0.0042, 0.006, steel, 12, "x")
    roundbar(0.0235, y, 0.006, 0.0048, 0.003, blue, 16, "x")
# Inductive end-position sensor with its M8 plug.
roundbar(-0.019, -0.04, -0.006, 0.004, 0.012, steel, 16, "x")
roundbar(-0.027, -0.04, -0.006, 0.0042, 0.006, seal, 16, "x")
block(-0.0115, -0.034, -0.006, 0.003, 0.004, 0.004, finish("Sensor LED", (0.9, 0.42, 0.04), 0, 0.3))
save("Stopper")

# Hardened stop head with a polyurethane buffer on the upstream (-X) face and a
# chamfered crown. Origin: head centre at its crown height.
mesh(
    [(x, y, z) for z in (-0.012, 0.012) for x, y in [(-0.0055, -0.03), (0.006, -0.03), (0.006, -0.001), (0.003, 0), (-0.0035, 0), (-0.0055, -0.002)]],
    [tuple(range(6)), tuple(range(6, 12))] + [(i, (i + 1) % 6, 6 + (i + 1) % 6, 6 + i) for i in range(6)],
    steel,
    0.0004,
)
block(-0.0068, -0.009, 0, 0.0026, 0.012, 0.02, seal, 0.0006)
save("StopHead")


# Reject container, after a moulded small-load carrier: tapered shell with wall
# thickness, outer ribs, stiffening band under the rim, hand grips in the short
# ends, a label slot and a stacking foot. Signal red so rejects are found at a glance.
red = finish("Reject polypropylene", (0.34, 0.036, 0.03), 0.0, 0.52)
grip = finish("Grip shadow", (0.06, 0.012, 0.011), 0.0, 0.7)


def rounded(w, d, r):
    pts = []
    for sx, sz, start in [(1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)]:
        for i in range(5):
            a = math.radians(start + i * 22.5)
            pts.append((sx * (w / 2 - r) + r * math.cos(a), sz * (d / 2 - r) + r * math.sin(a)))
    return pts


rings = [
    (0.212, 0.172, 0.0),
    (0.218, 0.178, 0.004),
    (0.221, 0.181, 0.012),
    (0.235, 0.195, 0.128),
    (0.244, 0.204, 0.129),
    (0.244, 0.204, 0.142),
    (0.238, 0.198, 0.143),
    (0.238, 0.198, 0.155),
    (0.247, 0.207, 0.157),
    (0.247, 0.207, 0.16),
    (0.229, 0.189, 0.16),
    (0.214, 0.174, 0.016),
    (0.214, 0.174, 0.012),
]
verts = [(x, y, z) for w, d, y in rings for x, z in rounded(w, d, 0.010)]
n = 20
faces = [tuple(range(n)), tuple(range((len(rings) - 1) * n, len(rings) * n))]
for j in range(len(rings) - 1):
    faces += [(j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i) for i in range(n)]
mesh(verts, faces, red)
lean = math.atan2((0.235 - 0.221) / 2, 0.116)
for sign in (-1, 1):
    # Long sides (+-Z): vertical ribs following the draft, a flat label field between.
    for x in (-0.099, -0.077, 0.077, 0.099):
        rib = block(0, 0, 0, 0.0035, 0.118, 0.006, red, 0.0006)
        rib.location = point(x, 0.07, sign * 0.0975)
        rib.rotation_euler.x = sign * lean
    # Label slot frame on the long sides.
    block(0, 0.1065, sign * 0.0978, 0.124, 0.003, 0.004, red, 0.0006)
    block(0, 0.0635, sign * 0.0952, 0.124, 0.003, 0.004, red, 0.0006)
    for x in (-0.0635, 0.0635):
        bar = block(0, 0, 0, 0.003, 0.046, 0.004, red, 0.0006)
        bar.location = point(x, 0.085, sign * 0.0965)
        bar.rotation_euler.x = sign * lean
    # Short ends (+-X): four ribs and a hand grip under the band.
    for z in (-0.07, -0.024, 0.024, 0.07):
        rib = block(0, 0, 0, 0.006, 0.09, 0.0035, red, 0.0006)
        rib.location = point(sign * 0.1165, 0.058, z)
        rib.rotation_euler.y = sign * lean
    block(sign * 0.1172, 0.115, 0, 0.0012, 0.022, 0.082, grip)
    block(sign * 0.1195, 0.1275, 0, 0.004, 0.003, 0.09, red, 0.0006)
# Stacking foot under the floor.
for x in (-0.09, 0.09):
    for z in (-0.07, 0.07):
        block(x, 0.0015, z, 0.02, 0.003, 0.02, red, 0.0005)
save("Tote")

# Air service unit on a wall bracket: shut-off valve, filter regulator with a
# guarded polycarbonate bowl and a gauge, soft-start valve, manifold block.
# Origin: bracket foot centre on the table; the unit faces +Z.
gauge_face = finish("Gauge face", (0.85, 0.86, 0.84), 0.0, 0.3)
bowl_poly = finish("Filter bowl", (0.55, 0.6, 0.62), 0.0, 0.12)
red_lever = finish("Valve lever", (0.42, 0.04, 0.03), 0.0, 0.4)
block(0, 0.003, -0.012, 0.2, 0.006, 0.05, dark, 0.001)
block(0, 0.09, -0.032, 0.2, 0.17, 0.004, alu, 0.0012)
for x in (-0.07, 0.0, 0.07):
    block(x, 0.142, -0.0105, 0.044, 0.044, 0.04, paint if x else alu, 0.003)
    block(x, 0.142, 0.0105, 0.04, 0.004, 0.003, dark)
block(-0.07, 0.173, -0.0105, 0.03, 0.018, 0.03, paint, 0.002)
lever = block(-0.07, 0.142, 0.016, 0.012, 0.05, 0.008, red_lever, 0.002)
roundbar(0, 0.177, -0.0105, 0.012, 0.026, dark, 24)
roundbar(0, 0.093, -0.0105, 0.017, 0.054, bowl_poly, 24)
roundbar(0, 0.093, -0.0105, 0.0185, 0.05, steel, 6)
roundbar(0, 0.062, -0.0105, 0.006, 0.01, dark, 16)
roundbar(0, 0.142, 0.0175, 0.0165, 0.008, dark, 32, "z")
quad(0, 0.142, 0.0217, 0.0296, 0.0296, "+z", gauge_face)
for x in (-0.108, 0.108):
    roundbar(x, 0.142, -0.0105, 0.0055, 0.012, steel, 16, "x")
    roundbar(x * 1.06, 0.142, -0.0105, 0.0062, 0.004, blue, 16, "x")
for x in (-0.035, 0.035):
    roundbar(x, 0.142, -0.0105, 0.0225, 0.004, dark, 4, "x")
save("AirPrep")

# Terminal box: grey moulded enclosure with a lid seam, captive lid screws, a
# rating label and cable glands on the bottom face. Origin: base centre.
grey_box = finish("Enclosure grey", (0.42, 0.44, 0.43), 0.0, 0.48)
block(0, 0.06, 0, 0.26, 0.12, 0.09, grey_box, 0.006)
block(0, 0.06, 0.0455, 0.25, 0.11, 0.002, grey_box, 0.004)
block(0, 0.06, 0.045, 0.2595, 0.1195, 0.0012, seal)
for x in (-0.115, 0.115):
    for y in (0.013, 0.107):
        roundbar(x, y, 0.047, 0.0035, 0.0012, grey_box, 12, "z")
        roundbar(x, y, 0.0477, 0.0018, 0.0004, seal, 6, "z")
quad(0.07, 0.085, 0.0468, 0.06, 0.03, "+z", nameplate)
for i in range(5):
    x = (i - 2) * 0.042
    roundbar(x, 0.0, 0.0, 0.009, 0.008, seal, 6)
    roundbar(x, -0.007, 0.0, 0.0065, 0.008, seal, 16)
save("JunctionBox")

# Conveyor return gearmotor: cast reduction housing, motor fins and fan cowl.
block(0, 0, 0, 0.112, 0.134, 0.095, alu, 0.011)
roundbar(0, 0, 0.054, 0.051, 0.018, dark, 32, "z")
roundbar(0, 0, 0.066, 0.032, 0.01, steel, 24, "z")
roundbar(0.132, 0, 0, 0.051, 0.157, dark, 32, "x")
for i in range(16):
    a = i * math.tau / 16
    fin = block(0, 0, 0, 0.13, 0.012, 0.004, alu)
    fin.location = point(0.13, 0.052 * math.cos(a), 0.052 * math.sin(a))
    fin.rotation_euler.x = a
roundbar(0.222, 0, 0, 0.054, 0.034, dark, 32, "x")
block(0.132, 0.064, 0, 0.069, 0.028, 0.056, dark, 0.004)
save("Gearmotor")

# Coil drive for vibratory bowls. The upper platen floats on inclined
# spring packs with a clear air gap above the magnet housing.
roundbar(0, 0.007, 0, 0.086, 0.014, dark, 48)
roundbar(0, 0.018, 0, 0.078, 0.011, alu, 48)
roundbar(0, 0.050, 0, 0.066, 0.062, paint, 48)
roundbar(0, 0.082, 0, 0.077, 0.010, dark, 48)
roundbar(0, 0.105, 0, 0.040, 0.042, seal, 32)
for i in range(6):
    a = math.tau * i / 6
    for offset in (-0.004, 0, 0.004):
        obj = block(0, 0, 0, 0.014, 0.043, 0.002, steel, 0.0004)
        obj.location = point(math.cos(a) * (0.060 + offset), 0.106, math.sin(a) * (0.060 + offset))
        obj.rotation_euler.y = 0.28
        obj.rotation_euler.z = -a
roundbar(0, 0.132, 0, 0.082, 0.013, alu, 48)
for i in range(8):
    a = math.tau * i / 8
    screws([math.cos(a) * 0.071], [math.sin(a) * 0.071], 0.088)
save("Vibrator")

# Cam index drive: two-piece casting, inspection cover and bearing ring.
block(0, 0.012, 0, 0.166, 0.024, 0.150, dark, 0.004)
block(0, 0.066, 0, 0.153, 0.093, 0.135, paint, 0.009)
for z in (-0.069, 0.069):
    block(0, 0.064, z, 0.124, 0.066, 0.006, alu, 0.004)
    for x in (-0.053, 0.053):
        for y in (0.041, 0.086):
            roundbar(x, y, z * 1.07, 0.003, 0.004, dark, 12, "z")
roundbar(0, 0.116, 0, 0.079, 0.018, dark, 48)
roundbar(0, 0.13, 0, 0.063, 0.012, steel, 48)
screws([-0.066, 0.066], [-0.064, 0.064], 0.025)
save("Indexer")

# Modular pneumatic terminal with split valve spools, contrasting manual
# overrides, brass fittings, and push-to-connect rings. Front faces +Z.
block(0, 0.004, 0, 0.126, 0.008, 0.048, alu)
for i in range(5):
    x = (i - 2) * 0.022
    block(x, 0.024, 0, 0.020, 0.035, 0.035, dark)
    block(x, 0.042, -0.006, 0.018, 0.009, 0.025, alu)
    roundbar(x, 0.047, -0.008, 0.003, 0.003, blue, 12)
    for y in (0.016, 0.032):
        roundbar(x, y, 0.020, 0.005, 0.008, steel, 10, "z")
        roundbar(x, y, 0.026, 0.0054, 0.004, blue, 16, "z")
block(-0.063, 0.022, 0, 0.014, 0.039, 0.039, paint)
save("ValveBank")

# Cleanroom operator wearing a hood, mask, smock and overshoes. Separate
# garment sections pivot at the existing hips and shoulders in the simulator.
cloth = finish("Cleanroom textile", (0.42, 0.56, 0.58), 0.0, 0.88)
cuff = finish("Knitted cuff", (0.24, 0.37, 0.39), 0.0, 0.94)
boot = finish("Antistatic sole", (0.11, 0.16, 0.16), 0.0, 0.7)
skin = finish("Complexion", (0.47, 0.29, 0.20), 0.0, 0.7)
mask = finish("Surgical mask", (0.72, 0.79, 0.77), 0, 0.86)
eye = finish("Iris", (0.047, 0.033, 0.025), 0, 0.45)


def loft(rings, material, segments=32):
    verts = [
        (cx + w * math.cos(i * math.tau / segments), y, cz + d * math.sin(i * math.tau / segments))
        for y, w, d, cx, cz in rings
        for i in range(segments)
    ]
    n = segments
    faces = [tuple(range(n)), tuple(range(len(verts) - n, len(verts)))]
    for j in range(len(rings) - 1):
        faces += [
            (j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i) for i in range(n)
        ]
    obj = mesh(verts, faces, material)
    # Cylindrical UVs (u round the body from +X, so the front is u = 0.25; v up the rings), for
    # the garment's seams and weave.
    uv = obj.data.uv_layers.new()
    for f in obj.data.polygons:
        idx = [obj.data.loops[k].vertex_index for k in f.loop_indices]
        wraps = any(v % n == n - 1 for v in idx) and any(v % n == 0 for v in idx)
        for k in f.loop_indices:
            v = obj.data.loops[k].vertex_index
            i, j = v % n, v // n
            u = 1.0 if (wraps and i == 0) else i / n
            uv.data[k].uv = (u, j / max(1, len(rings) - 1))
    for f in list(obj.data.polygons)[2:]:
        f.use_smooth = True


loft(
    [
        (0.80, 0.16, 0.102, 0, 0),
        (0.84, 0.177, 0.115, 0, 0),
        (0.94, 0.173, 0.119, 0, -0.009),
        (1.04, 0.151, 0.109, 0, 0),
        (1.17, 0.163, 0.119, 0, 0.003),
        (1.32, 0.192, 0.127, 0, 0.008),
        (1.405, 0.201, 0.106, 0, 0),
        (1.458, 0.161, 0.087, 0, 0),
        (1.483, 0.074, 0.069, 0, 0),
    ],
    cloth,
)
for i in range(11):
    y = 0.86 + i * 0.054
    block(0, y, 0.116 if y < 1.34 else 0.10, 0.005, 0.053, 0.003, cuff)
block(0.095, 1.319, 0.119, 0.067, 0.086, 0.007, mask, 0.002)
block(0.095, 1.344, 0.124, 0.054, 0.018, 0.002, blue)
loft(
    [
        (1.435, 0.071, 0.067, 0, 0),
        (1.491, 0.078, 0.072, 0, 0.01),
        (1.54, 0.087, 0.085, 0, 0.007),
        (1.60, 0.089, 0.094, 0, 0),
        (1.67, 0.091, 0.095, 0, -0.003),
        (1.711, 0.077, 0.080, 0, -0.009),
        (1.738, 0.048, 0.049, 0, -0.005),
        (1.748, 0.014, 0.018, 0, -0.005),
    ],
    cloth,
)
# Face panel, mask folded forward at the nose bridge and snug under the chin.
loft(
    [
        (1.54, 0.049, 0.03, 0, 0.057),
        (1.60, 0.074, 0.048, 0, 0.052),
        (1.655, 0.075, 0.044, 0, 0.042),
        (1.677, 0.061, 0.038, 0, 0.038),
    ],
    skin,
)
loft(
    [
        (1.531, 0.038, 0.025, 0, 0.055),
        (1.56, 0.068, 0.038, 0, 0.066),
        (1.594, 0.078, 0.045, 0, 0.066),
        (1.621, 0.068, 0.039, 0, 0.068),
    ],
    mask,
)
# Safety goggles over the eyes, with a strap round the hood.
goggle = finish("Goggle visor", (0.03, 0.04, 0.045), 0.6, 0.08)
loft(
    [(1.622, 0.083, 0.088, 0, 0.004), (1.637, 0.085, 0.09, 0, 0.004), (1.656, 0.084, 0.089, 0, 0.003)],
    goggle,
)
block(0, 1.639, 0.094, 0.082, 0.026, 0.006, goggle, 0.002)
save("Smock")
loft(
    [
        (-0.576, 0.032, 0.03, 0, 0.011),
        (-0.52, 0.049, 0.044, 0, 0.006),
        (-0.37, 0.060, 0.057, 0, -0.009),
        (-0.31, 0.062, 0.057, 0, -0.016),
        (-0.22, 0.067, 0.064, 0, -0.01),
        (-0.09, 0.077, 0.075, 0, 0),
        (-0.013, 0.073, 0.069, 0, 0),
        (0.022, 0.046, 0.046, 0, 0),
    ],
    cloth,
)
loft([(-0.597, 0.033, 0.033, 0, 0.012), (-0.551, 0.037, 0.034, 0, 0.009)], cuff)
loft(
    [
        (-0.695, 0.019, 0.018, 0, 0.044),
        (-0.659, 0.034, 0.023, 0, 0.041),
        (-0.607, 0.038, 0.028, 0, 0.027),
        (-0.587, 0.03, 0.03, 0, 0.017),
    ],
    finish("Nitrile glove", (0.08, 0.17, 0.45), 0.0, 0.42),
)
save("Sleeve")
loft(
    [
        (-0.77, 0.049, 0.048, 0, 0),
        (-0.70, 0.059, 0.067, 0, -0.008),
        (-0.57, 0.068, 0.080, 0, -0.019),
        (-0.46, 0.063, 0.064, 0, 0.009),
        (-0.405, 0.076, 0.068, 0, 0.012),
        (-0.35, 0.075, 0.074, 0, 0.014),
        (-0.17, 0.09, 0.095, 0, 0.003),
        (0.02, 0.09, 0.102, 0, 0),
        (0.072, 0.087, 0.096, 0, 0),
    ],
    cloth,
)
loft(
    [
        (-0.87, 0.064, 0.126, 0, 0.042),
        (-0.832, 0.066, 0.128, 0, 0.041),
        (-0.808, 0.062, 0.119, 0, 0.043),
        (-0.779, 0.057, 0.083, 0, 0.014),
        (-0.714, 0.052, 0.051, 0, -0.004),
    ],
    mask,
)
loft([(-0.879, 0.064, 0.128, 0, 0.041), (-0.863, 0.067, 0.13, 0, 0.041)], boot)
save("Trouser")

out = Path(__file__).resolve().parents[2] / "public/models/machine.glb"
bpy.ops.export_scene.gltf(filepath=str(out), export_apply=True)

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
for z in (-0.025, 0.025):
    roundbar(0, 0.001, z, 0.009, 0.009, dark, 20)
    roundbar(0, -0.004, z, 0.007, 0.002, steel, 20)
for y in (0.025, 0.105):
    block(0.010, y, 0.024, 0.007, 0.021, 0.004, dark)
    block(0.010, y+0.004, 0.0262, 0.002, 0.004, 0.0006, blue)
save("Cylinder")

# Moving crosshead, guide bushes, and parallel gripper. Tool datum is the
# top of the payload; the spindle seats on the upper face of the crosshead.
for z in (-0.021, 0.021):
    roundbar(0, 0.5, z, 0.0048, 1, steel, 16)
roundbar(0, 0.5, 0, 0.009, 1, steel)
save("GuidedRam")

block(0, 0.091, 0, 0.034, 0.013, 0.059, alu, 0.003)
for z in (-0.021, 0.021):
    roundbar(0, 0.097, z, 0.007, 0.003, dark, 16)
roundbar(0, 0.079, 0, 0.014, 0.012, dark, 24)
roundbar(0, 0.072, 0, 0.011, 0.004, steel, 24)
# Keyed quill and wiper project from the crosshead and retract into the
# gland on the drive cylinder; only the inner piston is exposed at full stroke.
roundbar(0, 0.134, 0, 0.012, 0.075, alu, 24)
roundbar(0, 0.172, 0, 0.0125, 0.004, dark, 24)
save("ToolFlange")

# Pneumatic wedge gripper with an open guideway and sliding jaw carriers.
# Long axis X, so the separation of the fingers reads from the belt.
block(0, 0.054, 0, 0.044, 0.032, 0.027, dark, 0.004)
for x in (-0.022, 0.022):
    roundbar(x, 0.055, 0, 0.0128, 0.004, alu, 20, "x")
for z in (-0.011, 0.011):
    block(0, 0.038, z, 0.043, 0.006, 0.005, steel)
for x in (-0.01, 0.01):
    roundbar(x, 0.058, -0.015, 0.003, 0.006, blue, 12, "z")
quad(0, 0.055, 0.0136, 0.024, 0.012, "+z", finish("Gripper plate", (0.6, 0.63, 0.63), 0.4, 0.42))
save("JawBody")


def jaw(name, radius, reach):
    # A stepped jaw with a circular relief milled into its replaceable pad.
    # The contact arc lies on a cylinder centred one radius inboard.
    block(0.004, 0.036, 0, 0.014, 0.009, 0.015, steel)
    # Wire-cut dogleg profile, wide at its mounting screws, narrowing to
    # leave clearance around the neck of the part.
    outline = [(0, .033), (.011, .033), (.011, .022), (.006, .012),
               (.006, -reach), (.0016, -reach), (.0016, .014), (.004, .023), (0, .023)]
    n = len(outline)
    mesh([(x, y, z) for z in (-.006, .006) for x, y in outline],
         [tuple(range(n)), tuple(range(n, 2*n))] +
         [(k, (k+1)%n, n+(k+1)%n, n+k) for k in range(n)], alu, .0006)
    for z in (-.0064, .0064):
        roundbar(.006, .028, z, .0024, .0014, dark, 12, "z")
    section = [(radius*(math.cos(a)-1), radius*math.sin(a))
               for a in [math.radians(v) for v in range(-72,73,12)]]
    # Constant-thickness horseshoe with exposed wings either side of the spine.
    section += [((radius + .0024)*math.cos(a)-radius, (radius + .0024)*math.sin(a))
                for a in [math.radians(v) for v in range(72,-73,-12)]]
    prism(section, -reach, -reach + .007, seal, 0.0003)
    prism(section, -reach + .009, -reach + .014, seal, 0.0003)
    roundbar(0.007, 0.024, 0, 0.002, 0.0012, dark, 8, "x")
    save(name)


jaw("TubeJaw", 0.0065, 0.010)
jaw("BarrelJaw", 0.0085, 0.010)
jaw("CartridgeJaw", 0.0048, 0.034)

# Through-bore spring pilot and press punch. Both have a retaining sleeve
# above the slender section that actually enters the transparent pen tube.
for name, reach, radius in [("SpringPilot", 0.064, 0.0034), ("PressPunch", 0.060, 0.0047)]:
    roundbar(0, 0.068, 0, 0.010, 0.006, dark, 24)
    roundbar(0, reach/2 + 0.004, 0, radius, reach+0.008, steel, 24)
    if name == "SpringPilot":
        # Split expanding mandrel: the lands seat against the spring bore.
        roundbar(0, -.016, 0, .0026, .032, steel, 20)
        for i in range(3):
            arc = [i*math.tau/3 + math.radians(v) for v in range(-50, 51, 10)]
            land = [(r*math.cos(a), r*math.sin(a)) for r, angles in
                    [(.00365, arc), (.0025, reversed(arc))] for a in angles]
            prism(land, -.030, .001, dark, .00025)
        roundbar(0, .005, 0, .0051, .009, steel, 24)
        roundbar(0, 0.002, 0, 0.0048, 0.004, dark, 24)
    else:
        # Vacuum land at the face captures the spring-base insert on pickup.
        roundbar(0, 0.0006, 0, 0.0048, 0.0012, seal)
    save(name)

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
# Removable rear service door with a recessed gasket, quarter-turn catches
# and a louvred cooling vent facing the operator aisle.
block(0, 0.249, -0.059, 0.056, 0.374, 0.003, joint, 0.001)
block(0, 0.249, -0.061, 0.052, 0.369, 0.003, white, 0.001)
for y in (0.083, 0.412):
    for x in (-0.019, 0.019):
        roundbar(x, y, -0.063, 0.003, 0.002, steel, 12, "z")
for i in range(6):
    block(0, 0.35+i*0.007, -0.0628, 0.033, 0.0024, 0.0015, dark)
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
# Flush bridge over the centre channel. Two cheeks leave the roller slot
# open when the piston drops; the passing puck clears the retaining screws.
for x in (-0.016, 0.016):
    block(x, -0.0044, 0, 0.016, 0.006, 0.038, alu, 0.001)
    for z in (-0.013, 0.013):
        roundbar(x, -0.0014, z, 0.0025, 0.0008, dark, 10)
for z in (-0.016, 0.016):
    block(0, -0.0044, z, 0.017, 0.006, 0.006, alu)
save("Stopper")

# Retractable roller plunger. The crown is the roller tangent, so both
# gate states retain their original belt and carrier clearance.
roundbar(0, -0.022, 0, 0.006, 0.028, steel)
for z in (-0.010, 0.010):
    block(0, -0.012, z, 0.012, 0.018, 0.003, dark, 0.0015)
roundbar(0, -0.007, 0, 0.007, 0.018, steel, 24, "z")
roundbar(0, -0.007, 0, 0.003, 0.025, dark, 12, "z")
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

# Gowned cleanroom operator: coverall with a hood cape, a hood with a face opening over mask
# and goggles, two-segment sleeves with knitted cuffs and five-finger nitrile gloves, overshoes,
# and a rugged handheld HMI. Each section has its own pivot (hips, shoulders, elbows, neck) so
# the simulator can pose it; the glove is a left hand (+X side), mirrored for the other arm.
cloth = finish("Cleanroom textile", (0.42, 0.56, 0.58), 0.0, 0.88)
plain = finish("Cleanroom textile plain", (0.42, 0.56, 0.58), 0.0, 0.88)
cuff = finish("Knitted cuff", (0.24, 0.37, 0.39), 0.0, 0.94)
boot = finish("Antistatic sole", (0.11, 0.16, 0.16), 0.0, 0.7)
skin = finish("Complexion", (0.47, 0.29, 0.20), 0.0, 0.7)
mask = finish("Surgical mask", (0.72, 0.79, 0.77), 0, 0.86)
glove = finish("Nitrile glove", (0.13, 0.25, 0.52), 0.0, 0.48)
lens = finish("Goggle lens", (0.10, 0.12, 0.13), 0.55, 0.05)
frame = finish("Goggle frame", (0.30, 0.33, 0.34), 0.0, 0.4)
strap = finish("Goggle strap", (0.06, 0.09, 0.12), 0.0, 0.7)
NECK = 1.47
SHOULDER = 1.413
ELBOW = 0.29


def loft(rings, material, segments=32, power=2.0, keep=None, caps=(True, True)):
    """Rings (y, half-width, half-depth, cx, cz) joined in order; superelliptic sections for
    power > 2. `keep(j, i)` may drop the quad between rings j, j + 1 at segment i."""
    def at(w, d, i):
        a = i * math.tau / segments
        c, s_ = math.cos(a), math.sin(a)
        e = 2 / power
        return w * math.copysign(abs(c) ** e, c), d * math.copysign(abs(s_) ** e, s_)

    verts = []
    for y, w, d, cx, cz in rings:
        for i in range(segments):
            x, z = at(w, d, i)
            verts.append((cx + x, y, cz + z))
    n = segments
    faces = []
    if caps[0]:
        faces.append(tuple(range(n)))
    if caps[1]:
        faces.append(tuple(range(len(verts) - n, len(verts))))
    for j in range(len(rings) - 1):
        faces += [
            (j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i)
            for i in range(n)
            if keep is None or keep(j, i)
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
    for f in obj.data.polygons:
        f.use_smooth = len(f.vertices) == 4
    return obj


def profile_at(table, y):
    """Linear interpolation of (y, w, d, cx, cz) rows at height y."""
    for a, b in zip(table, table[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return tuple(p + (q - p) * t for p, q in zip(a, b))
    return table[0] if y < table[0][0] else table[-1]


def sweep(path, radii, material, segments=10, closed=False, flat=1.0):
    """Tube through view-frame points, radius per point, with parallel-transported sections;
    `flat` squashes the section across the first normal. Open tubes get rounded tips."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    tan = []
    for i in range(n):
        a = pts[i - 1] if (closed or i) else pts[i]
        b = pts[(i + 1) % n] if (closed or i < n - 1) else pts[i]
        tan.append((b - a).normalized())
    ref = Vector((1, 0, 0)) if abs(tan[0].x) < 0.9 else Vector((0, 0, 1))
    nrm = tan[0].cross(ref).normalized()
    verts = []
    for i in range(n):
        if i:
            axis = tan[i - 1].cross(tan[i])
            if axis.length > 1e-9:
                from mathutils import Quaternion
                nrm.rotate(Quaternion(axis.normalized(), tan[i - 1].angle(tan[i])))
        bin_ = tan[i].cross(nrm)
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        for k in range(segments):
            a = k * math.tau / segments
            verts.append(tuple(pts[i] + (nrm * math.cos(a) * flat + bin_ * math.sin(a)) * r))
    faces = []
    rings = n if closed else n - 1
    for j in range(rings):
        j2 = (j + 1) % n
        faces += [(j * segments + k, j * segments + (k + 1) % segments, j2 * segments + (k + 1) % segments, j2 * segments + k) for k in range(segments)]
    if not closed:
        # Domed ends: one apex just beyond each end ring.
        for end, sign in ((0, -1), (n - 1, 1)):
            r = radii[end] if isinstance(radii, (list, tuple)) else radii
            verts.append(tuple(pts[end] + tan[end] * sign * r * 0.6))
            apex = len(verts) - 1
            faces += [(end * segments + k, end * segments + (k + 1) % segments, apex) for k in range(segments)]
    obj = mesh(verts, faces, material)
    for f in obj.data.polygons:
        f.use_smooth = True
    return obj


# Coverall: a loose, slightly boxy chest and shoulders that slope into the collar.
torso = [
    (0.80, 0.160, 0.104, 0, 0),
    (0.84, 0.176, 0.116, 0, 0),
    (0.94, 0.172, 0.119, 0, -0.008),
    (1.04, 0.153, 0.110, 0, 0),
    (1.17, 0.166, 0.120, 0, 0.004),
    (1.30, 0.188, 0.126, 0, 0.008),
    (1.37, 0.199, 0.118, 0, 0.004),
    (1.405, 0.200, 0.107, 0, 0),
    (1.432, 0.188, 0.097, 0, -0.002),
    (1.455, 0.160, 0.086, 0, -0.004),
    (1.472, 0.112, 0.076, 0, -0.004),
    (1.484, 0.070, 0.066, 0, -0.002),
]
loft(torso, cloth, 40, 2.5)
# Front zip under a placket, from the crotch to the collar, and a name badge.
for i in range(12):
    y = 0.87 + i * 0.047
    _, _, d, _, cz = profile_at(torso, y)
    block(0, y, cz + d + 0.0012, 0.006, 0.044, 0.003, cuff)
_, _, d, _, cz = profile_at(torso, 1.30)
block(0.098, 1.30, cz + d * 0.93 + 0.003, 0.064, 0.082, 0.006, mask, 0.002)
block(0.098, 1.325, cz + d * 0.93 + 0.0065, 0.052, 0.016, 0.002, blue)
# Elastic gathered at the waist, a shade darker than the coverall.
loft([(1.012, 0.1575, 0.1135, 0, 0.001), (1.034, 0.1555, 0.1125, 0, 0.001)], finish("Waist elastic", (0.46, 0.53, 0.55), 0.0, 0.92), 40, 2.5, caps=(False, False))
# Hood cape: the hood's bib lies over the shoulders and tucks under the zip.
loft(
    [
        (1.418, 0.175, 0.121, 0, 0.004),
        (1.440, 0.165, 0.113, 0, 0.002),
        (1.462, 0.140, 0.101, 0, -0.002),
        (1.484, 0.104, 0.088, 0, -0.004),
        (1.500, 0.078, 0.080, 0, -0.004),
    ],
    plain,
    40,
    2.2,
    caps=(False, True),
)
save("Smock")

# Hood over the head (pivot at the neck), open over the face. The face opening is an ellipse
# in (angle round the front, height); a knitted binding runs round its edge.
hood = [
    (1.470, 0.070, 0.076, 0, -0.004),
    (1.510, 0.077, 0.087, 0, 0.002),
    (1.550, 0.088, 0.101, 0, 0.006),
    (1.600, 0.094, 0.109, 0, 0.005),
    (1.650, 0.095, 0.111, 0, 0.001),
    (1.690, 0.091, 0.107, 0, -0.004),
    (1.720, 0.080, 0.095, 0, -0.008),
    (1.742, 0.060, 0.072, 0, -0.010),
    (1.756, 0.032, 0.040, 0, -0.010),
    (1.762, 0.008, 0.010, 0, -0.010),
]
SEG = 56
ys = [1.470 + k * 0.0115 for k in range(26)] + [1.762]
rings = [profile_at(hood, y) for y in ys]
rings = [(y - NECK, w, d, cx, cz) for y, w, d, cx, cz in rings]
FACE_Y, FACE_H, FACE_A = 1.619, 0.071, 0.98


def open_face(j, i):
    y = (ys[j] + ys[j + 1]) / 2
    a = ((i + 0.5) * math.tau / SEG) - math.pi / 2
    return ((y - FACE_Y) / FACE_H) ** 2 + (a / FACE_A) ** 2 > 1


loft(rings, plain, SEG, 2.0, keep=open_face, caps=(False, True))
rim = []
for k in range(48):
    t = k * math.tau / 48
    a = FACE_A * 0.985 * math.cos(t)
    y = FACE_Y + FACE_H * 0.985 * math.sin(t)
    _, w, d, cx, cz = profile_at(hood, y)
    phi = math.pi / 2 + a
    rim.append((cx + w * math.cos(phi), y - NECK, cz + d * math.sin(phi)))
sweep(rim, 0.0036, finish("Hood binding", (0.33, 0.43, 0.45), 0.0, 0.9), 8, closed=True)
# The head inside: skin shows only round the eyes, between the mask and the hood's brow.
loft(
    [
        (1.535 - NECK, 0.030, 0.034, 0, 0.018),
        (1.555 - NECK, 0.056, 0.070, 0, 0.016),
        (1.590 - NECK, 0.072, 0.086, 0, 0.012),
        (1.640 - NECK, 0.077, 0.090, 0, 0.010),
        (1.690 - NECK, 0.074, 0.088, 0, 0.004),
        (1.725 - NECK, 0.056, 0.070, 0, -0.002),
    ],
    skin,
    32,
)


# Eyes and brows behind the clear goggles.
iris = finish("Iris", (0.035, 0.026, 0.02), 0.0, 0.35)
brow = finish("Brow", (0.09, 0.06, 0.04), 0.0, 0.9)
for sx in (-1, 1):
    for y, x0, x1, r, m in ((1.646, 0.021, 0.041, 0.0042, iris), (1.664, 0.017, 0.046, 0.0032, brow)):
        pts = []
        for k in range(5):
            x = x0 + (x1 - x0) * k / 4
            _, w, d, cx, cz = profile_at([(1.59, 0.072, 0.086, 0, 0.012), (1.64, 0.077, 0.090, 0, 0.010), (1.69, 0.074, 0.088, 0, 0.004)], y)
            c = min(1.0, x / w)
            z = cz + d * math.sqrt(max(0.0, 1 - c * c)) + 0.0012
            pts.append((sx * x, y - NECK + (0.0016 if k in (1, 2, 3) else 0) * (1 if m is brow else 0.5), z))
        sweep(pts, r, m, 8, flat=0.55)


def front_band(y0, y1, w, d, cz, half_angle, material, steps=4, segments=48, bulge=0.0):
    """A band round the front of the head between two heights (mask, goggles)."""
    rings = []
    for k in range(steps + 1):
        y = y0 + (y1 - y0) * k / steps
        s_ = math.sin(math.pi * k / steps)
        rings.append((y - NECK, w + bulge * s_, d + bulge * s_, 0, cz))

    def keep(j, i):
        a = ((i + 0.5) * math.tau / segments) - math.pi / 2
        return abs(math.atan2(math.sin(a), math.cos(a))) < half_angle

    return loft(rings, material, segments, 2.0, keep=keep, caps=(False, False))


# Pleated mask over nose and mouth, ear loops under the hood.
front_band(1.548, 1.628, 0.076, 0.093, 0.013, 1.15, mask, 6, bulge=0.006)
for y in (1.572, 1.592, 1.610):
    front_band(y - 0.0015, y + 0.0015, 0.0835, 0.1005, 0.013, 1.05, plain, 1)
# Goggles: a smoked lens in a soft frame, strap round the outside of the hood.
front_band(1.630, 1.668, 0.083, 0.099, 0.011, 1.12, lens, 3, bulge=0.003)
for y in (1.627, 1.671):
    front_band(y - 0.003, y + 0.003, 0.0855, 0.1015, 0.011, 1.16, frame, 1)
loft([(1.641 - NECK, 0.0965, 0.1125, 0, 0.001), (1.655 - NECK, 0.0965, 0.1125, 0, 0.001)], strap, SEG, 2.0,
     keep=lambda j, i: abs(((i + 0.5) * math.tau / SEG) - math.pi / 2) > 1.05, caps=(False, False))
save("Head")

# Upper sleeve (pivot at the shoulder): a domed cap over the joint, loose to the elbow.
loft(
    [
        (0.040, 0.012, 0.012, 0, 0),
        (0.033, 0.038, 0.037, 0, 0),
        (0.018, 0.056, 0.055, 0, 0),
        (0.000, 0.063, 0.062, 0, 0),
        (-0.080, 0.062, 0.060, 0, -0.004),
        (-0.180, 0.057, 0.056, 0, -0.006),
        (-0.265, 0.053, 0.053, 0, -0.002),
        (-0.300, 0.050, 0.051, 0, 0),
    ],
    plain,
    28,
)
save("Sleeve")

# Forearm (pivot at the elbow), knitted cuff and a left nitrile glove: palm facing -X (in),
# thumb forward, fingers slightly curled.
loft(
    [
        (0.040, 0.020, 0.020, 0, 0),
        (0.024, 0.046, 0.046, 0, 0),
        (0.000, 0.053, 0.053, 0, 0),
        (-0.090, 0.050, 0.049, 0, 0.003),
        (-0.170, 0.044, 0.043, 0, 0.004),
        (-0.205, 0.040, 0.040, 0, 0.004),
        (-0.214, 0.032, 0.034, 0, 0.004),
    ],
    plain,
    28,
)
loft([(-0.206, 0.0335, 0.035, 0, 0.004), (-0.240, 0.031, 0.033, 0, 0.004)], cuff, 24)
loft(
    [
        (-0.226, 0.024, 0.028, 0, 0.004),
        (-0.250, 0.021, 0.028, -0.001, 0.004),
        (-0.272, 0.017, 0.039, -0.002, 0.004),
        (-0.300, 0.0155, 0.043, -0.003, 0.003),
        (-0.322, 0.0145, 0.042, -0.004, 0.002),
        (-0.334, 0.011, 0.036, -0.005, 0.002),
    ],
    glove,
    24,
    2.4,
)
for z, length, r in ((0.026, 0.070, 0.0083), (0.009, 0.079, 0.0088), (-0.009, 0.074, 0.0085), (-0.025, 0.059, 0.0077)):
    p = Vector((-0.005, -0.326, z + 0.002))
    pts, radii = [tuple(p)], [r]
    bend = 0.0
    for frac, turn in ((0.46, 0.32), (0.30, 0.38), (0.24, 0.0)):
        steps = 3
        for _ in range(steps):
            p = p + Vector((-math.sin(bend), -math.cos(bend), 0)) * (length * frac / steps)
            pts.append(tuple(p))
            radii.append(r * (1 - 0.18 * len(radii) / 9))
        bend += turn
    sweep(pts, radii, glove, 10)
thumb = [(-0.006, -0.262, 0.030), (-0.011, -0.278, 0.046), (-0.016, -0.296, 0.056), (-0.020, -0.314, 0.059), (-0.022, -0.330, 0.058)]
sweep(thumb, [0.0105, 0.0098, 0.0092, 0.0086, 0.0080], glove, 10)
save("Forearm")

# Coverall leg (pivot at the hip) and overshoe with an antistatic sole.
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
    plain,
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

# Rugged handheld HMI: rubber-cornered housing, screen (painted by the app) and hand straps.
# Centred on its back face, screen facing +Y.
shell = finish("Tablet housing", (0.035, 0.04, 0.045), 0.0, 0.5)
block(0, 0.009, 0, 0.236, 0.018, 0.158, shell, 0.004)
for x in (-0.113, 0.113):
    for z in (-0.074, 0.074):
        block(x, 0.009, z, 0.026, 0.022, 0.026, seal, 0.004)
block(0, 0.0185, 0, 0.212, 0.0012, 0.136, seal)
quad(0, 0.0192, 0.002, 0.196, 0.118, "+y", finish("Tablet screen", (0.1, 0.12, 0.13), 0.0, 0.2))
for x in (-0.07, 0.07):
    block(x, -0.002, 0, 0.03, 0.005, 0.15, strap, 0.002)
block(0.09, 0.0192, -0.072, 0.012, 0.0012, 0.006, finish("Tablet key", (0.6, 0.08, 0.06), 0.0, 0.4))
save("Tablet")

out = Path(__file__).resolve().parents[2] / "public/models/machine.glb"
bpy.ops.export_scene.gltf(filepath=str(out), export_apply=True)

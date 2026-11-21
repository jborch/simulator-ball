"""Bake broad indirect-light occlusion on the two horizontal receiving surfaces.
Rebuild from the current installed geometry with:
node tools/scripts/shots.mjs /tmp/line-bake --only overview --wait 1 --bake-contacts
"""

import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix

input_file, deck = sys.argv[sys.argv.index("--") + 1 :]
output = Path(__file__).resolve().parents[2] / "public/textures"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=input_file)
machine = bpy.context.object
machine.matrix_world = Matrix.Rotation(math.pi / 2, 4, "X")
machine.visible_camera = False

bpy.ops.mesh.primitive_plane_add(size=12)
receiver = bpy.context.object
material = bpy.data.materials.new("Irradiance fraction")
material.use_nodes = True
tree = material.node_tree
ao = tree.nodes.new("ShaderNodeAmbientOcclusion")
ao.samples = 32
emission = tree.nodes.new("ShaderNodeEmission")
tree.links.new(ao.outputs["AO"], emission.inputs["Color"])
tree.links.new(emission.outputs[0], tree.nodes["Material Output"].inputs["Surface"])
receiver.data.materials.append(material)

bpy.ops.object.camera_add(location=(0, 0, 4))
camera = bpy.context.object
camera.rotation_euler = (0, 0, 0)
camera.data.type = "ORTHO"
camera.data.ortho_scale = 8
scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "CYCLES"
scene.cycles.samples = 7
scene.cycles.use_denoising = False
scene.render.resolution_percentage = 100
scene.render.resolution_x = 1536
scene.render.resolution_y = 960
scene.view_settings.view_transform = "Raw"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "BW"
scene.render.image_settings.color_depth = "8"
for surface, height, distance in [("floor", 0, 1.35), ("deck", float(deck), 0.42)]:
    receiver.location.z = height + 0.00065
    ao.inputs["Distance"].default_value = distance
    scene.render.filepath = str(output / (surface + "_ao.png"))
    bpy.ops.render.render(write_still=True)

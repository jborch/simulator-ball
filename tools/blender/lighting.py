"""Prepare the local reflection probe from Poly Haven's 1K Industrial Workshop
Foundry HDR. Run blender -b -P tools/blender/lighting.py -- /path/to/original.hdr.
Neutralise the foundry's warm colour cast for a white production suite; retain
the angular detail, window shapes and dynamic range of the original capture.
"""

import sys
from pathlib import Path
import bpy
import numpy as np

source = bpy.data.images.load(sys.argv[sys.argv.index("--") + 1])
w, h = source.size
pixels = np.empty(w * h * 4, dtype=np.float32)
source.pixels.foreach_get(pixels)
rgb = pixels.reshape(h, w, 4)[:, :, :3]
latitude = np.sin(np.pi * (np.arange(h) + 0.5) / h)
white = np.average(rgb.mean(axis=1), axis=0, weights=latitude)
rgb *= 0.50 / np.maximum(0.001, white)
luma = np.sum(rgb * [0.2126, 0.7152, 0.0722], axis=2, keepdims=True)
rgb[:] = 0.75 * luma + 0.25 * rgb
source.pixels.foreach_set(pixels)
source.filepath_raw = str(
    Path(__file__).resolve().parents[2] / "public/textures/industrial_workshop_foundry_1k.hdr"
)
source.file_format = "HDR"
source.save()

import * as THREE from 'three';
import { compact, installHardware } from './hardware';
import { applyClearFinishes } from './clear';
import { refinish } from './finishes';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const MODEL_NAMES = ['mover', 'pen_body', 'spring', 'spring_base', 'cartridge', 'pen', 'tray', 'housing', 'machine'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];
export type Models = Record<ModelName, THREE.Object3D>;

/** Loads the Blender-generated glTF models (tools/blender/parts.py → public/models). */
export async function loadModels(): Promise<Models> {
  const loader = new GLTFLoader();
  const base = `${import.meta.env.BASE_URL}models/`;
  const entries = await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${base}${name}.glb`);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      refinish(gltf.scene);
      if (name === 'machine') installHardware(gltf.scene);
      else {
        gltf.scene.userData.product = true;
        // The housing tubes come out of Blender's boolean and bevel with banded normals: smooth
        // them round the tube, keeping the creases at the ends and the sight port.
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && /_shell$/.test(mesh.name || mesh.parent?.name || '')) mesh.geometry = toCreasedNormals(mesh.geometry, Math.PI / 5);
        });
        applyClearFinishes(gltf.scene);
        // The mover is compacted with its per-carrier plates and lights (movers.ts).
        if (name !== 'mover') compact(gltf.scene, (m) => m.name.endsWith('_label'));
      }
      return [name, gltf.scene] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as Models;
}

export function findMesh(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && (o.name === name || o.parent?.name === name)) found = o as THREE.Mesh;
  });
  return found;
}

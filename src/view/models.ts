import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_NAMES = ['mover', 'pen_body', 'spring', 'spring_base', 'cartridge', 'pen', 'tray', 'nest', 'housing', 'cap'] as const;
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

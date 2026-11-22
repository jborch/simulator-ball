import * as THREE from 'three';

// World-aligned second UV set for the horizontal receivers baked in
// tools/blender/contacts.py. Diffuse and finish maps retain their own UVs.
export function applyContactMap(group: THREE.Object3D, material: THREE.MeshStandardMaterial, surface: 'floor' | 'deck'): void {
  if (!material.aoMap) {
    material.aoMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/${surface}_ao.png`);
    material.aoMap.channel = 1;
    material.aoMapIntensity = surface === 'deck' ? 0.94 : 0.86;
  }
  group.updateWorldMatrix(true, true);
  const p = new THREE.Vector3();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.material !== material) return;
    const coords = o.geometry.attributes.position;
    const uv = new Float32Array(coords.count * 2);
    for (let i = 0; i < coords.count; i++) {
      p.fromBufferAttribute(coords, i).applyMatrix4(o.matrixWorld);
      uv[2 * i] = 0.5 + p.x / 8;
      uv[2 * i + 1] = 0.5 - p.z / 5;
    }
    o.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  });
}

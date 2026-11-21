// Clear and frosted parts (pen bodies, cartridge glass, the drug) without a transmission pass.
// A clear wall is seen edge-on at a silhouette, so it looks denser and darker there and almost
// clear face-on: opacity and tint follow the view angle. Reflections are added on top of the
// opacity (glass reflects whatever it lets through), so highlights read against a bright room.
import * as THREE from 'three';

export interface ClearSpec {
  color: number;
  /** Tint at grazing angles (the wall seen edge-on). */
  edge: number;
  /** Opacity face-on and edge-on. */
  opacity: [number, number];
  roughness: number;
  /** How fast the edge tint and opacity rise toward the silhouette. */
  power?: number;
  envMapIntensity?: number;
}

export function clearMaterial(spec: ClearSpec): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: spec.envMapIntensity ?? 1.4,
  });
  const edge = new THREE.Color(spec.edge);
  const shape = new THREE.Vector3(spec.opacity[0], spec.opacity[1], spec.power ?? 2.2);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.clearEdge = { value: edge };
    sh.uniforms.clearShape = { value: shape };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 clearEdge;\nuniform vec3 clearShape;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float clearRim = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), clearShape.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, clearEdge, clearRim);
        diffuseColor.a = mix(clearShape.x, clearShape.y, clearRim);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float clearSpec = dot(reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(outgoingLight, clamp(diffuseColor.a + clearSpec, 0.0, 1.0));`,
      );
  };
  return m;
}

/** Shared finishes for the product's clear parts, replacing the glTF ones by material name. */
export const CLEAR = {
  /** Pen body: clear polycarbonate with a faint blue cast, lightly frosted. */
  BodyFrost: clearMaterial({ color: 0xeef3f6, edge: 0x4a6470, opacity: [0.16, 0.93], roughness: 0.22, power: 1.45 }),
  /** Cartridge and window glass. */
  Glass: clearMaterial({ color: 0xf4f9fb, edge: 0x5e7a82, opacity: [0.07, 0.82], roughness: 0.05, power: 2.4, envMapIntensity: 1.8 }),
  /** The drug in the cartridge: a pale amber solution. */
  Drug: clearMaterial({ color: 0xf0c54e, edge: 0xb07d1c, opacity: [0.62, 0.94], roughness: 0.08, power: 1.6 }),
} as const;

export function applyClearFinishes(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const replacement = CLEAR[mesh.material.name as keyof typeof CLEAR];
    if (replacement) {
      mesh.material = replacement;
      mesh.castShadow = mesh.material === CLEAR.Drug;
    }
  });
}

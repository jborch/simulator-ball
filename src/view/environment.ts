// Reflection and ambient light probe of the production room, rendered once per lighting preset:
// a box the size of the hall with rows of bright ceiling light strips, pale walls with the
// gallery windows as a darker band, a grey floor and darker ceiling. Metals then show the strip
// lights and the room the line stands in, and the diffuse part lights the machines from above.
import * as THREE from 'three';

export interface RoomLight {
  /** Radiance of the ceiling strips. */
  strips: number;
  stripColor: number;
  /** Brightness of walls, floor and ceiling (lit by the strips). */
  room: number;
  /** Radiance of the gallery windows on the long walls. */
  windows: number;
  windowColor: number;
}

function panel(g: THREE.Group, w: number, h: number, color: THREE.Color, pos: THREE.Vector3, rot: THREE.Euler): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  m.position.copy(pos);
  m.rotation.copy(rot);
  g.add(m);
}

/** Builds the probe scene for `light` and prefilters it (PMREM) at a point above the line. */
export function roomEnvironment(renderer: THREE.WebGLRenderer, light: RoomLight): THREE.Texture {
  const scene = new THREE.Scene();
  const g = new THREE.Group();
  scene.add(g);
  const L = 18;
  const D = 13.2;
  const H = 4.5;
  const c = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);
  // Floor: grey resin, a little darker under the line. Kept dark, so metals get the usual
  // bright-above, dark-below gradient and read as metal from every side.
  panel(g, L, D, c(0x6c706e, light.room * 0.26), new THREE.Vector3(0, 0, 0), new THREE.Euler(-Math.PI / 2, 0, 0));
  panel(g, 7.4, 4.2, c(0x4e5250, light.room * 0.14), new THREE.Vector3(0, 0.01, 0), new THREE.Euler(-Math.PI / 2, 0, 0));
  // The machine decks round the probe: brushed steel at table height, lit from above. Metal
  // facing down and sideways (bowl walls, the undersides of axes) mirrors these, not the floor.
  panel(g, 6.6, 3.4, c(0xb4b9ba, light.room * 0.42), new THREE.Vector3(0, 0.84, 0), new THREE.Euler(-Math.PI / 2, 0, 0));
  // Ceiling, the strips in rows across the room, and two continuous light lines along the line
  // (they draw the long streaks on extrusions, rails and the belt's side profiles).
  panel(g, L, D, c(0xc9cbc6, light.room * 0.32), new THREE.Vector3(0, H, 0), new THREE.Euler(Math.PI / 2, 0, 0));
  for (let x = -8; x <= 8; x += 2)
    for (const z of [-4.2, 0, 4.2]) panel(g, 0.18, 2.8, c(light.stripColor, light.strips * 1.25), new THREE.Vector3(x, H - 0.05, z), new THREE.Euler(Math.PI / 2, 0, 0));
  for (const z of [-1.6, 1.6]) panel(g, 12, 0.12, c(light.stripColor, light.strips * 1.1), new THREE.Vector3(0, H - 0.6, z), new THREE.Euler(Math.PI / 2, 0, 0));
  // Walls: pale panels, a darker skirting, and on the long walls the gallery glazing.
  for (const [x, z, ry, w] of [
    [0, -D / 2, 0, L],
    [0, D / 2, Math.PI, L],
    [-L / 2, 0, Math.PI / 2, D],
    [L / 2, 0, -Math.PI / 2, D],
  ] as const) {
    // Into the room from this wall; skirting and windows sit just in front of it.
    const normalIn = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(0.01);
    const at = (y: number, inset = 0) => new THREE.Vector3(x, y, z).addScaledVector(normalIn, inset);
    panel(g, w, H, c(0xe4e3dc, light.room * 0.46), at(H / 2), new THREE.Euler(0, ry, 0));
    panel(g, w, 0.9, c(0xe4e3dc, light.room * 0.7), at(3.7, 0.5), new THREE.Euler(0, ry, 0));
    panel(g, w, 0.25, c(0x55605e, light.room * 0.25), at(0.13, 1), new THREE.Euler(0, ry, 0));
    if (Math.abs(z) > 1) {
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        const win = new THREE.Vector3(x + k * 2.2, 1.76, z).addScaledVector(normalIn, 1);
        panel(g, 1.8, 1.5, c(light.windowColor, light.windows), win, new THREE.Euler(0, ry, 0));
      }
    }
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.012, 0.1, 40, { size: 256, position: new THREE.Vector3(0, 1.45, 0) });
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return target.texture;
}

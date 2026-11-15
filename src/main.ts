import './style.css';
import * as THREE from 'three';
import { connectLocal } from './sim/client';
import { LINE } from './sim/config';
import { trackLength } from './sim/track';
import { Hud } from './view/hud';
import { FrameBuffer } from './view/interp';
import { LineView } from './view/line';
import { loadModels } from './view/models';
import { Stage } from './view/stage';

const clientName = `browser-${Math.random().toString(36).slice(2, 6)}`;
const client = connectLocal(clientName);
const frames = new FrameBuffer(trackLength(LINE.track));
const hud = new Hud(LINE, (c) => client.send(c));
const stage = new Stage(document.querySelector('#view')!);
const side = document.querySelector<HTMLElement>('#side')!;
new ResizeObserver(() => stage.setInsetRight(side.offsetWidth + 12)).observe(side);

client.onFrame = (f) => frames.push(f, performance.now() / 1000);
client.onEvents = (es) => hud.addEvents(es);

// CATCH.AI reporting runs in the worker. On by default when the server's /catchai proxy has an
// API key (it says so in /config.json); the topbar button turns it on/off and the choice is remembered.
const REPORTING_KEY = 'catchai.enabled';
const stored = localStorage.getItem(REPORTING_KEY);
let reporting = stored !== null ? stored === 'true' : (await loadRuntimeConfig()).catchaiProxy;
client.setReporting(reporting);
client.onReporting = (s) => hud.reporting(s);
hud.onToggleReporting = () => {
  reporting = !reporting;
  localStorage.setItem(REPORTING_KEY, String(reporting));
  client.setReporting(reporting);
  hud.reporting(reporting ? { state: 'connecting' } : null);
};

const models = await loadModels();
const line = new LineView(LINE, models);
stage.scene.add(line.group);
stage.fit(line.bounds());

// Click a mover to inspect it; a ring marks the selection.
const ray = new THREE.Raycaster();
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.085, 0.095, 40),
  new THREE.MeshBasicMaterial({ color: 0x4fc3ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
ring.visible = false;
stage.labels.domElement.addEventListener('click', (ev) => {
  const r = stage.labels.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), stage.camera);
  const hit = ray.intersectObjects(line.movers.map((m) => m.root), true)[0];
  let o: THREE.Object3D | null = hit?.object ?? null;
  while (o && o.userData.moverId === undefined) o = o.parent;
  hud.selectedMover = (o?.userData.moverId as number | undefined) ?? null;
  ring.removeFromParent();
  if (o) o.add(ring);
  ring.visible = !!o;
});

let last = performance.now() / 1000;
let lastHud = 0;
function loop() {
  const now = performance.now() / 1000;
  const dt = now - last;
  last = now;
  const sample = frames.sample(now);
  if (sample) {
    line.update(sample, frames, dt);
    if (now - lastHud > 0.1) {
      lastHud = now;
      hud.update(sample.b);
    }
  }
  if (hud.selectedMover === null) ring.visible = false;
  stage.render();
  requestAnimationFrame(loop);
}
loop();

// Dev-only handle for poking at the scene from the console (e.g. moving the camera).
if (import.meta.env.DEV) Object.assign(window, { THREE, line: { stage, view: line, client, frames } });

/** Served by the Vite dev/preview server and by server/app.js in production. */
async function loadRuntimeConfig(): Promise<{ catchaiProxy: boolean }> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    const data: unknown = res.ok ? await res.json() : null;
    return { catchaiProxy: typeof data === 'object' && data !== null && (data as { catchaiProxy?: unknown }).catchaiProxy === true };
  } catch {
    return { catchaiProxy: false };
  }
}

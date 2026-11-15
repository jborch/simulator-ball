import './style.css';
import * as THREE from 'three';
import { connectRemote } from './sim/client';
import { LINE } from './sim/config';
import { trackLength } from './sim/track';
import { Hud } from './view/hud';
import { FrameBuffer } from './view/interp';
import { LineView } from './view/line';
import { loadModels } from './view/models';
import { Stage } from './view/stage';

const clientName = `browser-${Math.random().toString(36).slice(2, 6)}`;
const client = connectRemote(clientName);
const frames = new FrameBuffer(trackLength(LINE.track));
const hud = new Hud(LINE, (c) => client.send(c));
const stage = new Stage(document.querySelector('#view')!);
const side = document.querySelector<HTMLElement>('#side')!;
new ResizeObserver(() => stage.setInsetRight(side.offsetWidth + 12)).observe(side);

client.onFrame = (f) => frames.push(f, performance.now() / 1000);
client.onEvents = (es) => hud.addEvents(es);
// A new connection may be to a restarted server (sim time back at 0), so start the buffer over.
client.onConnection = (state) => {
  frames.reset();
  hud.connection(state);
};

// CATCH.AI reporting runs on the server (on when it has an API key). The topbar button turns it
// on/off for the line, so every viewer sees the change.
let reporting = false;
client.onReporting = (s) => {
  reporting = s !== null;
  hud.reporting(s);
};
hud.onReportingOff = () => {
  client.setReporting(false);
  hud.reporting(null);
};
hud.onToggleReporting = () => {
  client.setReporting(!reporting);
  hud.reporting(reporting ? null : { state: 'connecting' });
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


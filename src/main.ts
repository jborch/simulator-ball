import './style.css';
import * as THREE from 'three';
import { connectRemote } from './sim/client';
import { LINE } from './sim/config';
import { trackLength } from './sim/track';
import { CaptureFeed, captureParams } from './view/capture';
import { visibleObjects } from './view/oracle';
import { CameraFx } from './view/camerafx';
import { Hud } from './view/hud';
import { IncidentsView } from './view/incidents';
import { FrameBuffer } from './view/interp';
import { LineView } from './view/line';
import { loadModels } from './view/models';
import { Monitor } from './view/monitor';
import { SceneView } from './view/scene';
import { Stage } from './view/stage';

// `?capture=1`: opened by the server's headless Chrome to stream one camera over RTSP.
const capture = captureParams();
if (capture) document.body.classList.add('capture');
const clientName = capture ? `camera-${new URLSearchParams(location.search).get('cam') ?? 'overview'}` : `browser-${Math.random().toString(36).slice(2, 6)}`;
const client = connectRemote(clientName);
const frames = new FrameBuffer(trackLength(LINE.track));
const hud = new Hud(LINE, (c) => client.send(c));
const stage = new Stage(document.querySelector('#view')!);
const side = document.querySelector<HTMLElement>('#side')!;
// The capture feed is the bare camera view: no panels to make room for, no DOM labels.
const sideInset = () => (capture ? 0 : side.offsetWidth + 12);
stage.showLabels = !capture;
stage.setInsetRight(sideInset(), true);

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
// Surroundings that vary per run (lighting, wear, people) and the visible incidents.
const scene = new SceneView(LINE, stage, line.movers);
const incidents = new IncidentsView(LINE, models, line.movers);
stage.scene.add(incidents.group);
// Camera realism (`fx=1`; the server sets it on the RTSP feeds unless CAMERA_REALISM=off). It
// follows the selected fixed camera; works in a normal browser too, for a look at the effect.
const params = new URLSearchParams(location.search);
const fx = params.get('fx') === '1' ? new CameraFx(stage.renderer, stage.scene, stage.camera, params.get('cam') ?? 'overview') : null;
let simT = 0;
if (fx) stage.renderOverride = () => fx.render(stage.camera, simT);

// Object oracle: a capture feed reports the boxes of the objects it sees, 5 times a second, when the
// server asks for them (RTSP_OBJECTS=1). Taken with the camera's pose at render time.
let lastObjects = 0;
function reportObjects(camera: THREE.Camera): void {
  const send = window.__cameraObjects;
  const now = Date.now();
  if (!send || now - lastObjects < 200) return;
  lastObjects = now;
  void send(JSON.stringify({ time: new Date(now).toISOString(), objects: visibleObjects(stage.scene, camera) }));
}
if (fx) fx.onPosed = reportObjects;
const bounds = line.bounds();
const monitor = new Monitor(LINE, stage, () => bounds, sideInset);
new ResizeObserver(() => monitor.insetChanged()).observe(side);

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
    simT = sample.t;
    scene.update(sample.b);
    incidents.update(sample.b.incidents);
    if (fx) {
      fx.setSeed(sample.b.scene.seed);
      fx.exposure = scene.exposure;
      fx.running = sample.b.machine === 'Execute';
    }
    line.update(sample, frames, dt);
    if (now - lastHud > 0.1) {
      lastHud = now;
      hud.update(sample.b);
    }
  }
  if (hud.selectedMover === null) ring.visible = false;
  stage.render();
  if (capture && !fx) reportObjects(stage.camera);
  feed?.frame();
  if (!capture) requestAnimationFrame(loop);
}
// A capture feed renders on its own steady clock (each render is one video frame); a screen
// renders with the display.
const feed = capture ? new CaptureFeed(stage.renderer.domElement, capture) : null;
// A feed whose WebGL context is lost (GPU pressure, a driver reset) would stream black forever:
// reload the page, which reconnects and resumes streaming.
if (capture) {
  stage.renderer.domElement.addEventListener('webglcontextlost', () => {
    console.error('[capture] WebGL context lost; reloading the page');
    setTimeout(() => location.reload(), 1000);
  });
}
if (capture) setInterval(loop, 1000 / capture.fps);
else loop();

// Dev-only handle for poking at the scene from the console (e.g. moving the camera).
if (import.meta.env.DEV) Object.assign(window, { THREE, line: { stage, view: line, client, frames, monitor } });


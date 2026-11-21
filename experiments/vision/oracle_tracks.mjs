// Object oracle → VMS: turns the simulator's ground-truth object boxes (server started with
// RTSP_OBJECTS=1) into object-track annotations in VMS, for demos of object annotations and of
// path-based anomaly detection. Labelled `source: "sim-oracle"`, `provenance: "simulator"`: it is
// ground truth, so it must never train or score the video analyses.
//
// One annotation per track chunk (at most CHUNK_S): `box` is the first box, and
// `attributes.keyframes` holds [ms after startTime, x, y, width, height] in fractions of the frame.
//
// usage: node experiments/vision/oracle_tracks.mjs [--map springbase:2,cartridge:3,housing:4]
//        [--vms http://localhost:6500] [--ws ws://127.0.0.1:5173/ws] [--offset-ms 0] [--classes mover,person,robot,pen,part]
//        [--token <bearer>] [--dry-run]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] === undefined || all[i + 1].startsWith('--') ? 'true' : all[i + 1]]] : acc), []));
const map = Object.fromEntries((args.map ?? 'springbase:2,cartridge:3,housing:4').split(',').map((x) => x.split(':')).map(([k, v]) => [k, Number(v)]));
const vms = (args.vms ?? process.env.VMS_URL ?? 'http://localhost:6500').replace(/\/$/, '');
const wsUrl = args.ws ?? 'ws://127.0.0.1:5173/ws';
const offsetMs = Number(args['offset-ms'] ?? 0); // VMS frame time minus render time
const classes = new Set((args.classes ?? 'mover,person,robot,pen,part').split(','));
const token = args.token ?? process.env.VMS_TOKEN;
const dryRun = args['dry-run'] === 'true';

const CHUNK_S = 15; // short, so tracks show up soon when following live
const LOST_MS = 1000; // a track not seen for this long ends its chunk

/** Open chunks by `${camera}|${id}`. */
const open = new Map();
let pending = [];
let posted = 0;

function close(key) {
  const c = open.get(key);
  open.delete(key);
  if (!c || c.keyframes.length < 2) return;
  const [, x, y, w, h] = c.keyframes[0];
  pending.push({
    cameraId: c.cameraId,
    source: 'sim-oracle',
    label: c.cls,
    trackId: c.id,
    startTime: new Date(c.start).toISOString(),
    endTime: new Date(c.start + c.keyframes.at(-1)[0]).toISOString(),
    box: { x, y, width: w, height: h },
    attributes: { provenance: 'simulator', keyframes: c.keyframes },
  });
}

function onObjects(camera, time, objects) {
  const cameraId = map[camera];
  if (!cameraId) return;
  const t = Date.parse(time) + offsetMs;
  const seen = new Set();
  for (const o of objects) {
    if (!classes.has(o.cls)) continue;
    const key = `${camera}|${o.id}`;
    seen.add(key);
    let c = open.get(key);
    if (c && (t - c.start > CHUNK_S * 1000 || t - c.last > LOST_MS)) {
      close(key);
      c = null;
    }
    if (!c) {
      c = { cameraId, id: o.id, cls: o.cls, start: t, last: t, keyframes: [] };
      open.set(key, c);
    }
    c.keyframes.push([t - c.start, ...o.box]);
    c.last = t;
  }
  for (const [key, c] of open) if (key.startsWith(`${camera}|`) && !seen.has(key) && t - c.last > LOST_MS) close(key);
}

async function flush() {
  if (pending.length === 0) return;
  const batch = pending.splice(0, 500);
  if (dryRun) {
    for (const a of batch) console.log(JSON.stringify({ ...a, attributes: { ...a.attributes, keyframes: `${a.attributes.keyframes.length} keyframes` } }));
    return;
  }
  const res = await fetch(`${vms}/api/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    console.error(`POST /api/annotations: ${res.status} ${await res.text()}`);
    pending = batch.concat(pending).slice(-5000); // keep, but don't grow without bound
    return;
  }
  posted += batch.length;
}

function connect() {
  const ws = new WebSocket(wsUrl);
  ws.on('open', () => console.log(`connected to ${wsUrl}; cameras ${JSON.stringify(map)} → ${vms}${dryRun ? ' (dry run)' : ''}`));
  ws.on('message', (data) => {
    const m = JSON.parse(data);
    if (m.type === 'objects') onObjects(m.camera, m.time, m.objects);
  });
  ws.on('close', () => setTimeout(connect, 2000));
  ws.on('error', (e) => console.error(`ws: ${e.message}`));
}

connect();
setInterval(() => flush().catch((e) => console.error(`post: ${e.message}`)), 2000);
setInterval(() => console.log(`${new Date().toISOString()} open tracks ${open.size}, posted ${posted}`), 60_000);
process.on('SIGINT', async () => {
  for (const key of [...open.keys()]) close(key);
  await flush().catch(() => {});
  process.exit(0);
});

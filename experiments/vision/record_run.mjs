// Records a test run from a running simulator: every camera over RTSP, plus ground truth for
// scoring (never for training): when each visible incident, robot fault, feeder jam and sub-line
// alarm was on, by wall-clock time. After --train seconds of normal running it injects a schedule
// of incidents and faults (the test phase).
//
// usage: node record_run.mjs --out ../../recordings/run1 [--train 600] [--test 420]
//        [--cams springbase,cartridge,housing] [--ws ws://127.0.0.1:5173/ws]
//        [--rtsp rtsp://127.0.0.1:18554]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(root, 'package.json'));
const WebSocket = require('ws');
const ffmpeg = require('ffmpeg-static');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const out = path.resolve(args.out ?? path.join(root, 'recordings', `run-${Date.now()}`));
const train = Number(args.train ?? 600);
const test = Number(args.test ?? 420);
// The robot cameras. All five at once can drop below 25 fps on a busy Mac (GPU-bound).
const cams = args.cams === 'none' ? [] : (args.cams ?? 'springbase,cartridge,housing').split(',');
const wsUrl = args.ws ?? 'ws://127.0.0.1:5173/ws';
const rtsp = args.rtsp ?? 'rtsp://127.0.0.1:18554';

// Test phase, seconds after it starts. Spaced so each can be told apart.
const SCHEDULE = args.schedule ? JSON.parse(readFileSync(args.schedule, 'utf8')) : [
  [20, { type: 'incident', kind: 'jam', station: 'EM40' }],
  [75, { type: 'fault', target: 'EM41' }],
  [150, { type: 'incident', kind: 'loosePen', station: 'EM11' }],
  [190, { type: 'incident', kind: 'jam', station: 'EM14B' }],
  [240, { type: 'fault', target: 'EM14B' }],
  [320, { type: 'incident', kind: 'tiltedPen', station: 'EM41' }],
  [330, { type: 'incident', kind: 'missingSpring', station: 'EM14B' }],
  [350, { type: 'incident', kind: 'droppedPart', station: 'EM11' }],
  [380, { type: 'incident', kind: 'jam', station: 'EM11' }],
];

mkdirSync(out, { recursive: true });
const gtFile = path.join(out, 'truth.jsonl');
writeFileSync(gtFile, '');
const log = (o) => appendFileSync(gtFile, JSON.stringify(o) + '\n');

const t0 = Date.now();
const total = train + test;
writeFileSync(path.join(out, 'run.json'), JSON.stringify({ start: new Date(t0).toISOString(), train, test, cams, schedule: SCHEDULE }, null, 2));
// Matroska stays readable if the recording is cut short. Stopped by the wall clock (not -t, which
// counts stream time and runs long if the feed ever falls behind real time).
const procs = cams.map((c) =>
  spawn(ffmpeg, ['-v', 'error', '-y', '-rtsp_transport', 'tcp', '-i', `${rtsp}/${c}`, '-c', 'copy', path.join(out, `${c}.mkv`)], { stdio: ['ignore', 'inherit', 'inherit'] }),
);
setTimeout(() => procs.forEach((p) => p.kill('SIGINT')), total * 1000);

// Ground truth from the frames: an interval per thing that is "on".
const on = new Map(); // key -> start ISO
const ws = new WebSocket(wsUrl);
const at = () => new Date().toISOString();
function track(key, active, info) {
  if (active && !on.has(key)) {
    on.set(key, at());
    log({ event: 'start', time: on.get(key), key, ...info });
  } else if (!active && on.has(key)) {
    on.delete(key);
    log({ event: 'end', time: at(), key, ...info });
  }
}
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type !== 'frame') return;
  const f = msg.frame;
  const seen = new Set();
  for (const x of f.incidents) {
    seen.add(`incident:${x.id}`);
    track(`incident:${x.id}`, true, { kind: x.kind, station: x.station, moverId: x.moverId });
  }
  for (const key of on.keys()) if (key.startsWith('incident:') && !seen.has(key)) track(key, false, {});
  for (const s of f.stations) track(`fault:${s.id}`, s.fault > 0, { kind: 'robotFault', station: s.id });
  for (const fd of f.feeders) track(`jam:${fd.id}`, fd.jam > 0, { kind: 'feederJam', feeder: fd.id });
  for (const [k, v] of Object.entries(f.alarms)) track(`alarm:${k}`, v > 0, { kind: 'alarm', alarm: k });
  track('machine', f.machine !== 'Execute', { kind: 'machineNotExecute', state: f.machine });
});
ws.on('open', () => {
  console.log(`recording ${cams.join(', ')} for ${total} s into ${out}; test phase from ${train} s`);
  for (const [t, cmd] of SCHEDULE) {
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'command', command: cmd, origin: 'record_run' }));
      log({ event: 'command', time: at(), command: cmd });
      console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s: ${JSON.stringify(cmd)}`);
    }, (train + t) * 1000);
  }
});
const stopped = new Promise((r) => setTimeout(r, total * 1000 + 2000));
Promise.all([stopped, ...procs.map((p) => new Promise((r) => p.on('exit', r)))]).then(() => {
  for (const key of [...on.keys()]) track(key, false, {});
  ws.close();
  console.log('done');
});

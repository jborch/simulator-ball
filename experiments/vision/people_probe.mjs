// Probe: frames of the simulator's camera views that show a person, with the ground-truth person boxes, to measure
// whether a person detector sees the simulator's people (people_probe.py scores them).
//
// Needs a simulator server without RTSP (nothing is published) and with CATCH.AI reporting off (.env.local turns it
// on), e.g. CATCHAI_API_KEY= CATCHAI_AUTH= PORT=5199 npx tsx src/server/index.ts
//   node experiments/vision/people_probe.mjs --url http://localhost:5199 --out /tmp/people --seconds 240
// Robot faults are triggered now and then, so operators walk up to the stations; the lighting changes every minute.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const WebSocket = require('ws');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const url = arg('url', 'http://localhost:5199');
const out = arg('out', '/tmp/people');
const seconds = Number(arg('seconds', 240));
const cams = arg('cams', 'springbase,cartridge,housing').split(',');
const faults = ['EM14B', 'EM41', 'EM40', 'EM14C', 'EM11'];
fs.mkdirSync(out, { recursive: true });

const ws = new WebSocket(url.replace(/^http/, 'ws') + '/ws');
await new Promise((ok, fail) => { ws.on('open', ok); ws.on('error', fail); });
const command = (cmd) => ws.send(JSON.stringify({ type: 'command', command: cmd, origin: 'people_probe' }));

const browser = await puppeteer.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pages = [];
for (const cam of cams) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const state = { cam, page, people: [], at: 0 };
  await page.exposeFunction('__cameraObjects', (json) => {
    const m = JSON.parse(json);
    state.people = m.objects.filter((o) => o.cls === 'person');
    state.at = Date.now();
  });
  await page.goto(`${url}/?cam=${cam}&capture=1&fx=1&fps=10`, { waitUntil: 'load', timeout: 60_000 });
  pages.push(state);
}
console.log(`probing ${cams.join(', ')} for ${seconds} s → ${out}`);
const index = [];
const start = Date.now();
let n = 0;
let lastFault = 0;
let lastLight = -1;
const lightings = ['night', 'day', 'evening', 'dim'];
while (Date.now() - start < seconds * 1000) {
  // A different lighting every minute: the detector has to work in all of them.
  const light = Math.floor((Date.now() - start) / 60_000) % lightings.length;
  if (light !== lastLight) {
    command({ type: 'scene', lighting: lightings[light] });
    lastLight = light;
  }
  if (Date.now() - lastFault > 30_000) {
    command({ type: 'fault', target: faults[Math.floor(Math.random() * faults.length)] });
    lastFault = Date.now();
  }
  for (const s of pages) {
    // Only people with a box big enough to recognise, seen in the last half second.
    const people = Date.now() - s.at < 500 ? s.people.filter((p) => p.box[2] * p.box[3] > 0.004) : [];
    if (!people.length) continue;
    const file = `${s.cam}-${String(n++).padStart(5, '0')}.jpg`;
    await s.page.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 90 });
    index.push({ file, cam: s.cam, lighting: lightings[lastLight], people: people.map((p) => ({ id: p.id, box: p.box })) });
  }
  await new Promise((r) => setTimeout(r, 1000));
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
console.log(`${index.length} frames with people`);
await browser.close();
ws.close();

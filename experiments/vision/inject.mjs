// Keeps people in view for a recording: a robot fault every --every s (an operator walks up to clear it), and a
// new lighting every --light s. --every 0: no faults (normal running). --seed: the scene seed (camera mounts, wear).
// Start that simulator with CATCHAI_API_KEY= CATCHAI_AUTH= so it doesn't report to CATCH.AI.
// usage: node inject.mjs --ws ws://127.0.0.1:5199/ws --seconds 1200 [--every 40] [--light 180] [--seed N]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const ws = new WebSocket(arg('ws', 'ws://127.0.0.1:5199/ws'));
const seconds = Number(arg('seconds', 1200)), every = Number(arg('every', 40)), light = Number(arg('light', 180));
const stations = ['EM14B', 'EM41', 'EM40', 'EM14C', 'EM11', 'EM14A'];
const lightings = ['night', 'day', 'evening', 'dim'];
const send = (command) => ws.send(JSON.stringify({ type: 'command', command, origin: 'inject' }));
ws.on('open', () => {
  const t0 = Date.now();
  let k = 0;
  send({ type: 'scene', lighting: lightings[0], ...(arg('seed') ? { seed: Number(arg('seed')) } : {}) });
  const timer = setInterval(() => {
    const t = (Date.now() - t0) / 1000;
    if (t > seconds) { clearInterval(timer); ws.close(); return; }
    k++;
    if (every > 0 && k % every === 0) send({ type: 'fault', target: stations[Math.floor(Math.random() * stations.length)] });
    if (k % light === 0) send({ type: 'scene', lighting: lightings[(k / light) % lightings.length] });
  }, 1000);
});

// Renders a fixed set of views of the line to PNGs, for before/after comparisons of the 3D look.
//
//   node tools/scripts/shots.mjs <out_dir> [--port 5199] [--wait 25] [--lighting day] [--only overview,hero-robot]
//
// Add --timing for 60 gl.finish-synchronised stage renders per view (median and p90), --fx to
// render the station cameras with camera realism (as the RTSP feeds do).
// --bake-contacts regenerates the floor/deck textures instead of taking screenshots.
// --wait-for-mark waits for a labelled mover in the housing/cartridge inspection view.
// --wait-for-press captures hero-presses during an insertion stroke on EM14A.
// Starts the dev server (fixed sim and scene seed, so every run shows much the same line), opens
// each view in headless Chrome with the GPU and saves <out_dir>/<view>.png. The views are the
// overview, the five installed station cameras (as the RTSP feeds see them, without camera realism)
// and a few close-ups placed in station-local coordinates (see src/view/cameras.ts).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'shots');
const port = Number(opt('port', 5199));
const waitS = Number(opt('wait', 25));
const lighting = opt('lighting', 'day');
const only = opt('only', '')?.split(',').filter(Boolean);
mkdirSync(out, { recursive: true });

/** Close-ups: mount and aim in station-local coordinates (a along travel, y up from belt, r outward). */
const HEROES = [
  { id: 'hero-robot', fov: 40, mount: { station: 'EM11', a: -0.55, y: 0.55, r: -0.75 }, aim: { station: 'EM11', a: 0.2, y: 0.12, r: 0.15 } },
  { id: 'hero-presses', fov: 45, mount: { station: 'EM14B', a: -0.6, y: 0.7, r: 0.9 }, aim: { station: 'EM14B', a: 0.1, y: 0.05, r: 0.05 } },
  { id: 'hero-dial', fov: 42, mount: { station: 'EM40', a: 0.5, y: 0.6, r: 1.1 }, aim: { station: 'EM40', a: -0.1, y: 0.05, r: 0.3 } },
  { id: 'hero-outfeed', fov: 45, mount: { station: 'EM60', a: -0.5, y: 0.75, r: 1.0 }, aim: { station: 'EM60', a: 0.15, y: 0.0, r: 0.3 } },
  // The station cameras' own mounts, from behind (springbase) and from across the belt (infeed).
  { id: 'mount-back', fov: 40, mount: { station: 'EM14B', a: 0.55, y: 0.3, r: -1.05 }, aim: { station: 'EM14B', a: 0.12, y: 0.08, r: -0.64 } },
  { id: 'mount-front', fov: 50, mount: { station: 'EM11', a: 0.75, y: 0.45, r: 0.35 }, aim: { station: 'EM11', a: 0.32, y: 0.12, r: -0.64 } },
  { id: 'mount-close', fov: 32, mount: { station: 'EM14B', a: 0.42, y: 0.24, r: -0.42 }, aim: { station: 'EM14B', a: 0.12, y: 0.08, r: -0.68 } },
  { id: 'hero-movers', fov: 30, mount: { station: 'EM12', a: 0.35, y: 0.12, r: -0.35 }, aim: { station: 'EM12', a: -0.1, y: 0.04, r: 0.0 } },
];
const CAMS = ['overview', 'infeed', 'springbase', 'cartridge', 'housing', 'outfeed'];

const server = spawn('npx', ['tsx', 'src/server/index.ts', '--dev'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SCENE_SEED: '7', SCENE_LIGHTING: lighting, CATCHAI_API_KEY: '', CATCHAI_AUTH: '', RTSP_CAMERAS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const started = Date.now();
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

const base = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  if (i > 120) throw new Error('server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-angle=metal'],
});
try {
  // Let the line fill up (sim time runs from server start), the same amount every run.
  const left = waitS * 1000 - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  const views = [...CAMS.map((id) => ({ id })), ...HEROES].filter((v) => !only?.length || only.includes(v.id));
  for (const v of views) {
    const page = await browser.newPage();
    page.on('console', (m) => m.type() === 'error' && console.error(`[page ${v.id}] ${m.text()}`));
    page.on('pageerror', (e) => console.error(`[page ${v.id}] ${e.message}`));
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    const fx = args.includes('--fx') && !v.mount ? '&fx=1' : '';
    await page.goto(`${base}/?capture=1&fps=30${fx}&cam=${v.mount ? 'overview' : v.id}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => !!window.line?.view, { timeout: 60_000 });
    if (args.includes('--bake-contacts')) {
      const { bakeContacts } = await import('./bake-contacts.mjs');
      await bakeContacts(page);
      await page.close();
      break;
    }
    if (v.mount) {
      await page.evaluate(async (v) => {
        const { stationPoint } = await import('/src/view/cameras.ts');
        const { LINE } = await import('/src/sim/config.ts');
        window.line.stage.view({ position: stationPoint(LINE, v.mount), target: stationPoint(LINE, v.aim), fov: v.fov });
      }, v);
    }
    // A few seconds of frames: buffered sim frames, shadows and textures settle.
    await new Promise((r) => setTimeout(r, 4000));
    if (args.includes('--wait-for-mark') && ['housing', 'cartridge'].includes(v.id)) {
      // Capture an actual carrier in the inspection window, with no change
      // to its pose, the lens or the live simulation.
      await page.waitForFunction(() => {
        const { view, stage } = window.line;
        return view.movers.some(({ root }) => {
          const p = root.position.clone().project(stage.camera);
          if (Math.abs(p.x) > 0.32 || Math.abs(p.y) > 0.95 || p.z < 0 || p.z > 1) return false;
          let printed = false;
          root.traverseVisible(o => {
            if (o.name === 'pen_dm_label' && o.material?.map) printed = true;
          });
          return printed;
        });
      }, { timeout: 90_000 });
    }
    if (args.includes('--wait-for-press') && v.id === 'hero-presses') {
      // The tool datum follows the top of the insert. Below the body mouth,
      // the locating nose is visibly inside the tube during the real stroke.
      await page.waitForFunction(() => {
        const station = window.line.frames.latest()?.stations.find(s => s.id === 'EM14A');
        const ram = station?.robots[0];
        return station?.moverId != null && ram?.phase === 'press' && ram.z < 0.113;
      }, { timeout: 90_000 });
    }
    if (args.includes('--timing')) {
      const stats = await page.evaluate(async () => {
        const { stage } = window.line;
        const gl = stage.renderer.getContext();
        const times = [];
        for (let i = 0; i < 65; i++) {
          await new Promise(requestAnimationFrame);
          gl.finish();
          const t = performance.now();
          stage.render();
          gl.finish();
          if (i >= 5) times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        return { medianMs: times[30], p90Ms: times[54], ...stage.renderer.info.render };
      });
      console.log(v.id, stats);
    }
    const file = path.join(out, `${v.id}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}

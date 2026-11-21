// Server entry point. Runs the line simulation and streams it to browsers over a WebSocket (/ws).
//   npm run dev   → tsx watch src/server/index.ts --dev   (frontend through Vite with HMR)
//   npm start     → node dist/server/index.js             (frontend from dist/client)
//
// Configuration comes from environment variables. For convenience the same .env files Vite uses
// are read from the project root, most specific first; real environment variables always win:
//   .env.<mode>.local, .env.local, .env.<mode>, .env      (mode: development or production)
//
//   PORT              port to listen on (default 3000, 5173 with --dev)
//   HOST              interface to bind (default 0.0.0.0)
//   CATCHAI_API_KEY   CATCH.AI API key; when set, reporting starts on
//   CATCHAI_URL       CATCH.AI server root (default: the demo server)
//   CATCHAI_AUTH      `none` for a CATCH.AI server with authentication off: report without a key
//   CATCHAI_TIME_OFFSET_HOURS  report every time this many hours earlier (default 0)
//   CLIENT_DIR        built frontend to serve (default dist/client)
//   LOG_REQUESTS      1 to log every HTTP request
//
// RTSP camera streams (headless Chrome → ffmpeg → MediaMTX; see cameras.ts):
//   RTSP_CAMERAS      camera ids to stream, comma-separated, or `all` (default: none, off)
//   RTSP_PORT         port of the bundled MediaMTX (default 18554, clear of a stock MediaMTX)
//   RTSP_PUBLISH_URL  publish to this RTSP server instead of the bundled one, e.g.
//                     rtsp://user:pass@vms:8554/simulator (the camera id is appended)
//   RTSP_TIMESTAMP    1 to burn the wall-clock time (ISO 8601, UTC) into the picture
//   RTSP_CHROME_ARGS  extra Chrome flags, space-separated (e.g. --use-angle=vulkan)
//   RTSP_BITRATE_KBPS H.264 bit rate per camera (default 1500 with CAMERA_REALISM on, else 4000)
//   CAMERA_REALISM    `off` for clean rendered pictures; on by default: sensor noise, blur, lens
//                     distortion, flicker, shake and a slightly different mount on every run
//
// Scene and visible incidents (for testing vision; see src/sim/incidents.ts):
//   SCENE_SEED        camera mounts, mover wear and people walking past (default: new each run)
//   SCENE_LIGHTING    day, evening, night or dim (default day)
//   INCIDENT_LOG      append each visible incident's start and end to this file (JSON lines)
//   MEDIAMTX_PATH     MediaMTX binary (default: vendor/mediamtx, fetched on npm install)
//   FFMPEG_PATH       ffmpeg binary (default: the one from the ffmpeg-static package)
import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATCHAI_URL } from '../catchai/api';
import { CAMERAS, OVERVIEW } from '../view/cameras';
import { LIGHTINGS, type Lighting } from '../sim/types';
import { CameraStreams, parseCameraList, REALISTIC_BITRATE_KBPS, redact as redactUrl, STREAM } from './cameras';
import { LineHost } from './host';
import { createHttpServer, type HttpOptions } from './http';
import { MediaMtx } from './mediamtx';
import { attachLineSocket } from './ws';

const dev = process.argv.includes('--dev');
const mode = dev ? 'development' : 'production';
// Both src/server/index.ts and the bundled dist/server/index.js sit two levels below the root.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const name of [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']) {
  const file = path.join(root, name);
  if (existsSync(file)) process.loadEnvFile(file);
}

const env = process.env;
const port = Number(env.PORT ?? (dev ? 5173 : 3000));
const hostname = env.HOST || '0.0.0.0';
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const catchaiUrl = env.CATCHAI_URL || DEFAULT_CATCHAI_URL;
const apiKey = env.CATCHAI_API_KEY || undefined;
const noAuth = env.CATCHAI_AUTH === 'none';
const timeOffsetHours = Number(env.CATCHAI_TIME_OFFSET_HOURS || 0);
// Up to ten years either way: further than that dates stop being meaningful (or valid at all).
if (!Number.isFinite(timeOffsetHours) || Math.abs(timeOffsetHours) > 24 * 366 * 10) {
  throw new Error(`CATCHAI_TIME_OFFSET_HOURS must be a number of hours within ±87840 (ten years), got "${env.CATCHAI_TIME_OFFSET_HOURS}"`);
}
const sceneSeed = env.SCENE_SEED ? Number(env.SCENE_SEED) : undefined;
if (sceneSeed !== undefined && !(Number.isInteger(sceneSeed) && sceneSeed >= 0 && sceneSeed <= 0xffffffff)) {
  throw new Error(`SCENE_SEED must be a whole number from 0 to 4294967295, got "${env.SCENE_SEED}"`);
}
const lighting = env.SCENE_LIGHTING || undefined;
if (lighting !== undefined && !(LIGHTINGS as string[]).includes(lighting)) throw new Error(`SCENE_LIGHTING must be one of ${LIGHTINGS.join(', ')}, got "${lighting}"`);
const incidentLog = env.INCIDENT_LOG ? path.resolve(env.INCIDENT_LOG) : null;
const host = new LineHost({
  catchai: { url: catchaiUrl, apiKey, noAuth, enabled: !!apiKey || noAuth, timeOffsetHours },
  scene: { seed: sceneSeed, lighting: lighting as Lighting | undefined },
  onIncident: incidentLog ? (r) => appendFile(incidentLog, JSON.stringify(r) + '\n').catch((err) => log(`INCIDENT_LOG: ${err.message}`)) : undefined,
  log,
});
if (incidentLog) log(`visible incidents logged to ${incidentLog}`);

const httpOpts: HttpOptions = { log: env.LOG_REQUESTS === '1' ? log : undefined };
let vite: import('vite').ViteDevServer | null = null;
if (dev) {
  // Vite is created after the HTTP server (its HMR socket shares it), so route through a holder.
  httpOpts.middleware = (req, res, next) => (vite ? vite.middlewares(req, res, next) : next());
} else {
  httpOpts.clientDir = path.resolve(root, env.CLIENT_DIR || 'dist/client');
  if (!existsSync(path.join(httpOpts.clientDir, 'index.html'))) {
    console.error(`No build found in ${httpOpts.clientDir}. Run \`npm run build\` first.`);
    process.exit(1);
  }
}

const server = createHttpServer(httpOpts);
const wss = attachLineSocket(server, host, { exclusive: !dev, log });
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
}

let streamCameras: string[];
try {
  streamCameras = parseCameraList(env.RTSP_CAMERAS, [OVERVIEW.id, ...CAMERAS.map((c) => c.id)]);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
let mediamtx: MediaMtx | null = null;
let cameras: CameraStreams | null = null;

async function startCameraStreams(): Promise<void> {
  const rtspPort = Number(env.RTSP_PORT || 18554);
  let publishUrl = env.RTSP_PUBLISH_URL;
  if (!publishUrl) {
    mediamtx = new MediaMtx({ port: rtspPort, root, binary: env.MEDIAMTX_PATH, log });
    await mediamtx.start();
    publishUrl = `rtsp://127.0.0.1:${rtspPort}`;
  }
  const realism = env.CAMERA_REALISM !== 'off';
  const bitrateKbps = Number(env.RTSP_BITRATE_KBPS || (realism ? REALISTIC_BITRATE_KBPS : STREAM.bitrateKbps));
  if (!Number.isFinite(bitrateKbps) || bitrateKbps < 100 || bitrateKbps > 50_000) throw new Error(`RTSP_BITRATE_KBPS must be 100–50000, got "${env.RTSP_BITRATE_KBPS}"`);
  log(`cameras: realism ${realism ? 'on' : 'off'}, ${bitrateKbps} kbit/s`);
  const ffmpegPath = env.FFMPEG_PATH || (await import('ffmpeg-static')).default;
  if (!ffmpegPath) throw new Error('no ffmpeg for this platform; set FFMPEG_PATH');
  // The browser loads the app from this server, over loopback unless bound to one interface.
  const local = hostname === '0.0.0.0' || hostname === '::' ? '127.0.0.1' : hostname;
  cameras = new CameraStreams({
    cameras: streamCameras,
    appUrl: `http://${local.includes(':') ? `[${local}]` : local}:${port}`,
    publishUrl,
    timestamp: env.RTSP_TIMESTAMP === '1',
    realism,
    bitrateKbps,
    ffmpegPath,
    chromeArgs: env.RTSP_CHROME_ARGS?.split(/\s+/).filter(Boolean),
    // Ground-truth object boxes per camera, relayed to viewers (RTSP_OBJECTS=1; for VMS demos).
    onObjects: env.RTSP_OBJECTS === '1' ? (camera, time, objects) => host.relayObjects(camera, time, objects) : undefined,
    log,
  });
  cameras.start();
  const where = env.RTSP_PUBLISH_URL ? redactUrl(publishUrl) : `rtsp://<this host>:${rtspPort}`;
  log(`RTSP camera streams: ${streamCameras.map((id) => `${where}/${id}`).join(', ')}`);
}

host.start();
server.listen(port, hostname, () => {
  log(`${dev ? 'Development' : 'Production'} server on http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`);
  log(apiKey || noAuth ? `CATCH.AI reporting on: ${catchaiUrl}${apiKey ? '' : ' (no authentication)'}` : 'CATCH.AI reporting off (no CATCHAI_API_KEY)');
  if (streamCameras.length) {
    startCameraStreams().catch((err) => {
      log(`RTSP camera streams not started: ${(err as Error).message}`);
      mediamtx?.stop();
    });
  }
});
// Don't leave MediaMTX or ffmpeg running if Node goes down (Puppeteer does the same for Chrome).
process.on('exit', () => {
  cameras?.stopNow();
  mediamtx?.stop();
});

// Stop cleanly on docker stop / systemd / Ctrl+C (and on tsx watch restarts).
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, shutting down`);
    host.stop();
    void cameras?.stop();
    mediamtx?.stop();
    for (const ws of wss.clients) ws.close(1012, 'server restarting'); // viewers reconnect
    void vite?.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

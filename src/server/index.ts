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
//   MEDIAMTX_PATH     MediaMTX binary (default: vendor/mediamtx, fetched on npm install)
//   FFMPEG_PATH       ffmpeg binary (default: the one from the ffmpeg-static package)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATCHAI_URL } from '../catchai/api';
import { CAMERAS, OVERVIEW } from '../view/cameras';
import { CameraStreams, parseCameraList, redact as redactUrl } from './cameras';
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
const host = new LineHost({ catchai: { url: catchaiUrl, apiKey, enabled: !!apiKey }, log });

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
  const ffmpegPath = env.FFMPEG_PATH || (await import('ffmpeg-static')).default;
  if (!ffmpegPath) throw new Error('no ffmpeg for this platform; set FFMPEG_PATH');
  // The browser loads the app from this server, over loopback unless bound to one interface.
  const local = hostname === '0.0.0.0' || hostname === '::' ? '127.0.0.1' : hostname;
  cameras = new CameraStreams({
    cameras: streamCameras,
    appUrl: `http://${local.includes(':') ? `[${local}]` : local}:${port}`,
    publishUrl,
    timestamp: env.RTSP_TIMESTAMP === '1',
    ffmpegPath,
    chromeArgs: env.RTSP_CHROME_ARGS?.split(/\s+/).filter(Boolean),
    log,
  });
  cameras.start();
  const where = env.RTSP_PUBLISH_URL ? redactUrl(publishUrl) : `rtsp://<this host>:${rtspPort}`;
  log(`RTSP camera streams: ${streamCameras.map((id) => `${where}/${id}`).join(', ')}`);
}

host.start();
server.listen(port, hostname, () => {
  log(`${dev ? 'Development' : 'Production'} server on http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`);
  log(apiKey ? `CATCH.AI reporting on: ${catchaiUrl}` : 'CATCH.AI reporting off (no CATCHAI_API_KEY)');
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

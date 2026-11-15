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
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATCHAI_URL } from '../catchai/api';
import { LineHost } from './host';
import { createHttpServer, type HttpOptions } from './http';
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

host.start();
server.listen(port, hostname, () => {
  log(`${dev ? 'Development' : 'Production'} server on http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`);
  log(apiKey ? `CATCH.AI reporting on: ${catchaiUrl}` : 'CATCH.AI reporting off (no CATCHAI_API_KEY)');
});

// Stop cleanly on docker stop / systemd / Ctrl+C (and on tsx watch restarts).
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, shutting down`);
    host.stop();
    for (const ws of wss.clients) ws.close(1012, 'server restarting'); // viewers reconnect
    void vite?.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

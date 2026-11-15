// Production entry point: `npm start` (after `npm run build`).
//
// Configuration comes from environment variables. For convenience the same .env files Vite uses
// are read from the project root, most specific first; real environment variables always win:
//   .env.production.local, .env.local, .env.production, .env
//
//   PORT              port to listen on (default 3000)
//   HOST              interface to bind (default 0.0.0.0)
//   CATCHAI_API_KEY   CATCH.AI API key; added to proxied /catchai requests, never sent to browsers
//   CATCHAI_URL       CATCH.AI server root (default: the demo server)
//   DIST_DIR          built frontend to serve (default ./dist)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, DEFAULT_CATCHAI_URL } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.production.local', '.env.local', '.env.production', '.env']) {
  const file = path.join(root, name);
  if (existsSync(file)) process.loadEnvFile(file);
}

const env = process.env;
const port = Number(env.PORT ?? 3000);
const host = env.HOST || '0.0.0.0';
const distDir = path.resolve(root, env.DIST_DIR || 'dist');

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`No build found in ${distDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

const catchaiUrl = env.CATCHAI_URL || DEFAULT_CATCHAI_URL;
const server = createApp({
  distDir,
  catchaiUrl,
  catchaiApiKey: env.CATCHAI_API_KEY,
  log: env.LOG_REQUESTS === '0' ? undefined : (msg) => console.log(`${new Date().toISOString()} ${msg}`),
});

server.listen(port, host, () => {
  console.log(`Serving ${distDir} on http://${host}:${port}`);
  console.log(env.CATCHAI_API_KEY ? `CATCH.AI proxy: /catchai -> ${catchaiUrl}` : 'CATCH.AI proxy: no CATCHAI_API_KEY set, reporting is off by default');
});

// Let in-flight requests finish on shutdown (docker stop, systemd, Ctrl+C).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

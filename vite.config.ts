import type { ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';

// CATCH.AI doesn't send CORS headers, so the browser talks to it through our own server:
// /catchai/* → CATCHAI_URL/*, with the API key added server-side. Put the key in .env.local (git-ignored):
//   CATCHAI_API_KEY=...
//   CATCHAI_URL=https://...   (optional, defaults to the demo server)
// Neither is exposed to the browser bundle (no VITE_ prefix).
// This file covers `npm run dev` / `npm run preview`; in production server/app.js does the same.
const DEFAULT_URL = 'https://catchai-demo-axis-data.northeurope.cloudapp.azure.com';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'CATCHAI_');
  const key = env.CATCHAI_API_KEY ?? '';
  const proxy: Record<string, ProxyOptions> = {
    '/catchai': {
      target: env.CATCHAI_URL || DEFAULT_URL,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/catchai/, ''),
      headers: key ? { 'x-api-key': key } : {},
    },
  };
  return {
    plugins: [runtimeConfig({ catchaiProxy: key !== '' })],
    server: { proxy },
    preview: { proxy },
  };
});

/** Serves /config.json (runtime settings the frontend reads at startup), like server/app.js does. */
function runtimeConfig(config: { catchaiProxy: boolean }): Plugin {
  const body = JSON.stringify(config);
  const handle = (url: string | undefined, res: ServerResponse, next: () => void) => {
    if (url?.split('?')[0] !== '/config.json') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  };
  return {
    name: 'runtime-config',
    configureServer: (server) => void server.middlewares.use((req, res, next) => handle(req.url, res, next)),
    configurePreviewServer: (server) => void server.middlewares.use((req, res, next) => handle(req.url, res, next)),
  };
}

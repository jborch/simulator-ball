import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

// CATCH.AI doesn't send CORS headers, so the browser talks to it through the dev/preview server:
// /catchai/* → CATCHAI_URL/*, with the API key added here. Put the key in .env.local (git-ignored):
//   CATCHAI_API_KEY=...
//   CATCHAI_URL=https://...   (optional, defaults to the demo server)
// Neither is exposed to the browser bundle (no VITE_ prefix).
const DEFAULT_URL = 'https://catchai-demo-axis-data.northeurope.cloudapp.azure.com';

export default defineConfig(({ mode, command }) => {
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
    // Reporting starts by default only under the dev server; a static build has no proxy.
    define: { __CATCHAI_PROXY_KEY__: JSON.stringify(command === 'serve' && key !== '') },
    server: { proxy },
    preview: { proxy },
  };
});

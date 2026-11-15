import { defineConfig } from 'vite';

// The frontend is only the 3D view: the simulation runs in the Node server (src/server), which
// also hosts Vite in development. `npm run build` builds both:
//   vite build                                → dist/client (the browser app)
//   vite build --ssr src/server/index.ts      → dist/server (the server, one bundled file)
export default defineConfig(({ isSsrBuild }) => ({
  build: isSsrBuild
    ? { outDir: 'dist/server', copyPublicDir: false, target: 'node22', emptyOutDir: true }
    : { outDir: 'dist/client', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
}));

# Pen Assembly Line Simulator

A browser-only 3D simulation of a pharma (pen-injector) assembly line. Movers ride a friction
belt, stop at gates, and get worked on by pick-and-place robots fed from bowl feeders and
cartridge nests. Inspections reject about 5 % of pens. Every station reports `ItemProcessed` /
`ItemsMerged` records with real timings. See [docs/PLAN.md](docs/PLAN.md) for the design and
the reasoning behind it.

```sh
npm install
npm run dev        # http://localhost:5173 (reports to CATCH.AI if .env.local has a key)
npm test           # headless simulation + server tests
npm run build      # typecheck + production build into dist/
npm start          # serve dist/ for production on http://localhost:3000
```

## Running in production

The simulation itself runs entirely in the browser (in a Web Worker). In production, a small Node
server (`server/`, no dependencies) serves the built frontend and forwards CATCH.AI requests. This
proxy is needed because CATCH.AI sends no CORS headers and the API key must stay on the server.
It requires Node 22 or later.

```sh
npm ci                  # dev dependencies are needed for the build
npm run build           # → dist/
npm prune --omit=dev    # optional: the server only needs dist/ and server/
CATCHAI_API_KEY=... PORT=8080 npm start
```

The server reads its configuration from environment variables. It also loads `.env.production.local`,
`.env.local`, `.env.production` and `.env` from the project root, most specific file first. Real
environment variables always take precedence over the files.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `CATCHAI_API_KEY` | – | Added as `x-api-key` to proxied requests and never sent to the browser. If set, reporting is on by default |
| `CATCHAI_URL` | demo server | CATCH.AI server root |
| `DIST_DIR` | `dist` | Directory of the built frontend |
| `LOG_REQUESTS` | `1` | Set to `0` to turn off the per-request log lines |

What the server does:

- **Static files** from `dist/`, compressed with brotli or gzip (each compressed file is cached in memory). Hashed files in `/assets` get `immutable` caching. `index.html` and `/models` are revalidated with ETags, so a new deploy shows up right away.
- **`/catchai/*` → `CATCHAI_URL/*`**, with the API key added. Client cookies and any `x-api-key` sent by the client are dropped.
- **`/config.json`**: runtime settings for the frontend (`{ "catchaiProxy": true }` when a key is set). The same build therefore works with or without a key. The Vite dev/preview server serves this file too.
- **`/healthz`** returns `ok` for load-balancer and container health checks.
- On `SIGTERM`/`SIGINT` it stops taking new connections and lets in-flight requests finish (at most 10 s).

Notes for deploying:

- Anyone who can reach the server can send requests to CATCH.AI with your key through `/catchai`. Don't expose the server publicly without authentication in front of it, such as a reverse proxy, VPN or SSO gateway.
- Put TLS in a reverse proxy (nginx, Caddy, a cloud load balancer) and forward to `PORT`. No WebSocket or sticky sessions are needed.
- Run it under a process manager that restarts it on failure, e.g. systemd, a container runtime or pm2. Example systemd unit:

  ```ini
  [Service]
  WorkingDirectory=/opt/simulator-ball
  ExecStart=/usr/bin/node server/index.js
  Environment=PORT=8080
  EnvironmentFile=/etc/simulator-ball.env   # CATCHAI_API_KEY=...
  Restart=on-failure
  ```

- Each browser tab runs its own simulation and, if reporting is on, reports to CATCH.AI on its own. Keep one tab per line open when reporting.
- `npm run preview` also serves the build, including the proxy, but it's meant for checking the build locally, not for production.

## How it fits together

```
 Web Worker (host)                                          Main thread (any client)
┌──────────────────────────────────────────────┐  frames  ┌───────────────────────────┐
│ Plant (truth) ◄─ sensors / actuators ─► PLC  │ ───────► │ FrameBuffer → three.js     │
│  movers, belt, gates,              machine + │  events  │ view + HUD                 │
│  robots, cameras, feeders,         stations  │ ───────► │                            │
│  nests, tray, faults               → MES     │ ◄─────── │ commands (start, speed, …) │
└──────────────────────────────────────────────┘          └───────────────────────────┘
```

- **The plant is the only truth.** The PLC changes it only through actuator fields (gates, robot jobs, camera triggers, RFID requests, belt) and reads it only through sensors and RFID tags. The view never changes it.
- **All state is plain JSON** (`src/sim/types.ts`), and clients only see `Frame`/event/command messages (`src/sim/protocol.ts`). A remote viewer can therefore use the same protocol over a network later.
- **Fixed time steps:** the plant steps every 1 ms and the PLC scans every 10 ms. The worker drives it in real time.
- **Reproducible runs:** all randomness comes from one seeded RNG stored in the state.

### `src/sim` (headless, no DOM)

| File | Responsibility |
| --- | --- |
| `config.ts` | Line layout, stations, timings, quality model, faults, batch settings |
| `types.ts` | Serializable state types |
| `simulation.ts` | `Simulation`: steps plant + PLC, applies commands, drains events |
| `plant.ts` | Movers on the belt, gates, RFID readers, cameras; sensor image for the PLC |
| `robot.ts` | Cartesian robots: job programs (prepick/place/pickMover/drop), axis motion, grip/release effects |
| `devices.ts` | Bowl feeders, cartridge nests, tray outfeed, random-failure helpers |
| `assembly.ts` | Physical effect of placing parts and of inspecting (true quality + sensor noise) |
| `plc.ts` | PLC scan: machine states, batch run-out, fault reporting, station state machines |
| `commands.ts` | Operator commands and which machine states accept them |
| `records.ts` | Finished cycle → new tag + MES records + counters |
| `machine.ts` | Small shared helpers (events, machine state, batches, ids) |
| `frame.ts` | State → `Frame` for rendering |
| `worker.ts` / `client.ts` / `protocol.ts` | Real-time host in a Web Worker and the client side of the messages |
| `layout.ts`, `track.ts`, `tags.ts`, `gs1.ts`, `rng.ts` | Geometry, loop path, tag helpers, GS1 identifiers, seeded RNG |

### `src/view` (three.js)

| File | Responsibility |
| --- | --- |
| `interp.ts` | Buffers frames, renders ~100 ms in the past and interpolates |
| `line.ts` | Table, belt, movers and stations |
| `station.ts` | One station: gate pin, stack light, label and its equipment |
| `devices.ts` | Robot, camera, feeder, nest, tray, bin and scrap views |
| `movers.ts` | Movers with printed numbers, pen assemblies, parts held by grippers |
| `build.ts`, `stage.ts`, `models.ts`, `textures.ts` | Materials and geometry helpers, renderer/camera/lights, glTF loading, canvas textures (numbers, DataMatrix) |
| `hud.ts` | HTML controls, KPIs, batch panel, fault injection, event log, mover inspector |

### `src/catchai` (reporting)

| File | Responsibility |
| --- | --- |
| `catalogue.ts` | The line as CATCH.AI sees it: devices, processes, properties, events, item view |
| `setup.ts` | Creates what's missing before data is sent; finds our property/event keys and the scoped id base |
| `mapper.ts` | Sim events → `ItemProcessed` / `ItemsMerged` / device data / batch periods |
| `reporter.ts` | Queue, ordering, bulk sends, retries; runs in the worker |
| `api.ts`, `types.ts` | fetch wrapper and the REST contracts |

### `server` (production)

| File | Responsibility |
| --- | --- |
| `index.js` | Entry point for `npm start`: reads env / `.env` files, listens, shuts down cleanly |
| `app.js` | HTTP server: static `dist/`, compression and caching, `/catchai` proxy, `/config.json`, `/healthz` |

To report, put the API key in `.env.local` (git-ignored) and run `npm run dev`:

```sh
CATCHAI_API_KEY=...
# CATCHAI_URL=https://...   optional, defaults to the demo server
```

The dev server (and the production server, see above) proxies `/catchai` to CATCH.AI and adds
the key, so the browser never sees it.
The **CATCH.AI** button in the top bar turns reporting on/off. See [docs/PLAN.md §10d](docs/PLAN.md).

## 3D models

Parts and movers are generated by a Blender script, so they're reproducible:

```sh
blender -b -P tools/blender/parts.py -- public --no-render   # writes public/models/*.glb
```

Belts, frames, robots and feeders are built procedurally in `src/view`.

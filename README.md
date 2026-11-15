# Pen Assembly Line Simulator

A 3D simulation of a pharma (pen-injector) assembly line. Movers ride a friction belt, stop at
gates, and get worked on by pick-and-place robots fed from bowl feeders and cartridge nests.
Inspections reject about 5 % of pens. Every station reports `ItemProcessed` / `ItemsMerged`
records with real timings. See [docs/PLAN.md](docs/PLAN.md) for the design and the reasoning
behind it.

The simulation runs on a Node server and is streamed to browsers over a WebSocket. The browser
only renders the line in 3D and sends operator commands. Every browser sees the same line, and
the line keeps running with no browser open.

```sh
npm install
npm run dev        # http://localhost:5173: server + simulation, frontend with hot reload
npm test           # headless simulation, streaming and server tests
npm run build      # typecheck + production build into dist/client and dist/server
npm start          # run the production build on http://localhost:3000
```

`npm run dev` runs the server with [tsx](https://tsx.is) in watch mode, with Vite inside it for
the frontend. Changes under `src/view` reload the page. Changes to the simulation or the server
restart the server, which also restarts the simulation. The page reconnects by itself.

## Running in production

The server needs Node 22 or later. The build produces two parts:

- `dist/client`: the static frontend.
- `dist/server/index.js`: the server, bundled into one file. At runtime it needs only the `ws` package from `node_modules`.

```sh
npm ci                  # dev dependencies are needed for the build
npm run build
npm prune --omit=dev    # optional: what's left is dist/ plus the runtime node_modules
CATCHAI_API_KEY=... PORT=8080 npm start
```

The server reads its configuration from environment variables. It also loads `.env.production.local`,
`.env.local`, `.env.production` and `.env` from the project root, most specific file first.
In dev it loads the `.env.development*` files instead of the `.env.production*` ones. Real
environment variables always take precedence over the files.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` (`5173` in dev) | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `CATCHAI_API_KEY` | – | CATCH.AI API key. When set, the server reports to CATCH.AI from startup |
| `CATCHAI_URL` | demo server | CATCH.AI server root |
| `CLIENT_DIR` | `dist/client` | Directory of the built frontend |
| `LOG_REQUESTS` | off | Set to `1` to log every HTTP request. Viewer connects and disconnects are always logged |

The server listens on one port and handles:

- **`/ws`**: the WebSocket that viewers connect to (see [protocol](#protocol)).
- **Static files** from `dist/client`, compressed with brotli or gzip (each compressed file is cached in memory). Hashed files in `/assets` get `immutable` caching. `index.html` and `/models` are revalidated with ETags, so a new deploy shows up right away.
- **`/healthz`**: returns `ok` for load-balancer health checks.
- On `SIGTERM`/`SIGINT` it closes the viewer sockets (browsers retry and reconnect once it's back) and exits.

Notes for deploying:

- **Run one instance per line.** Each server process is one line with its own simulation. Two instances behind a load balancer would be two different lines.
- **The simulation lives in memory.** A restart starts a fresh simulation: new batch, counters at zero.
- **Every viewer can control the line**, and whoever can reach the server can run commands. There is no login. Put authentication in front of the server (reverse proxy with auth, VPN or SSO gateway) before exposing it beyond a trusted network.
- **Put TLS in a reverse proxy** (nginx, Caddy, a cloud load balancer) and forward to `PORT`. The proxy must pass WebSocket upgrades on `/ws`. Over HTTPS the page connects with `wss://`. For nginx:

  ```nginx
  location /ws {
      proxy_pass http://127.0.0.1:8080;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 1h;
  }
  location / {
      proxy_pass http://127.0.0.1:8080;
  }
  ```

- **Bandwidth:** about 30 frames a second of roughly 6.5 KB JSON each, so under 200 KB/s per viewer before compression. Messages are compressed with `permessage-deflate`. If a viewer falls behind, frames are skipped for it. A viewer more than 16 MB behind is disconnected.
- **Use a process manager** that restarts the server on failure, such as systemd or pm2. Example systemd unit:

  ```ini
  [Service]
  WorkingDirectory=/opt/simulator-ball
  ExecStart=/usr/bin/node dist/server/index.js
  Environment=PORT=8080
  EnvironmentFile=/etc/simulator-ball.env   # CATCHAI_API_KEY=...
  Restart=on-failure
  ```

## How it fits together

```
 Node server (host, src/server)                     WebSocket /ws      Browser (any number)
┌──────────────────────────────────────────────┐    frames ~30 Hz    ┌───────────────────────────┐
│ Plant (truth) ◄─ sensors / actuators ─► PLC  │ ──────────────────► │ FrameBuffer → three.js     │
│  movers, belt, gates,              machine + │    events, status   │ view + HUD                 │
│  robots, cameras, feeders,         stations  │ ──────────────────► │                            │
│  nests, tray, faults               → MES ──► CATCH.AI reporter     │ ◄── commands (start, …)    │
└──────────────────────────────────────────────┘ ◄────────────────── └───────────────────────────┘
```

- **The plant is the only truth.** The PLC changes it only through actuator fields (gates, robot jobs, camera triggers, RFID requests, belt) and reads it only through sensors and RFID tags. The view never changes it.
- **One line, many viewers.** The server runs a single simulation. A command from any browser is checked against the machine state and applied there. Everyone sees the result in the next frame, so all screens agree.
- **All state is plain JSON** (`src/sim/types.ts`), and viewers only see `Frame`/event/command messages (`src/sim/protocol.ts`).
- **Fixed time steps:** the plant steps every 1 ms and the PLC scans every 10 ms. The server drives it in real time.
- **Smooth rendering:** the browser renders about 150 ms behind the newest frame and interpolates, which hides network jitter.
- **Reproducible runs:** all randomness comes from one seeded RNG stored in the state.

### Protocol

JSON text messages over `ws(s)://<host>/ws` (types in `src/sim/protocol.ts`):

| Direction | Message | When |
| --- | --- | --- |
| server → browser | `frame` | On connect, then about 30 times a second: everything needed to draw the line and the HUD |
| server → browser | `events` | On connect (the last 200), then whatever happened since the last frame |
| server → browser | `catchai` | On connect, then every second: reporter status, or `null` when off |
| server → browser | `snapshot` | Reply to `snapshot`: the full simulation state (for debugging) |
| browser → server | `command` | Operator commands: start, stop, hold, speed, batch settings, fault injection |
| browser → server | `catchai` | Turn reporting on or off for the line |
| browser → server | `snapshot` | Ask for the full state |

The server validates every incoming message (`src/server/validate.ts`) and silently drops
anything malformed. If the connection drops, the browser shows **Offline** and reconnects with
backoff.

### `src/server` (Node: the host)

| File | Responsibility |
| --- | --- |
| `index.ts` | Entry point: env / `.env` files, dev (Vite middleware) or production (static files), shutdown |
| `host.ts` | `LineHost`: runs the simulation in real time, streams frames/events to viewers, owns the CATCH.AI reporter |
| `ws.ts` | WebSocket endpoint `/ws`: viewers, backpressure, pings, incoming messages |
| `validate.ts` | Checks every message from viewers against the protocol |
| `http.ts` | Static files (compression, caching), `/healthz`, or Vite's middleware in dev |

### `src/sim` (headless, no DOM, runs on the server)

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
| `protocol.ts` / `client.ts` | The messages, and the browser's WebSocket client (reconnects with backoff) |
| `layout.ts`, `track.ts`, `tags.ts`, `gs1.ts`, `rng.ts` | Geometry, loop path, tag helpers, GS1 identifiers, seeded RNG |

The browser uses only the config, geometry, protocol types and the command table from here.

### `src/view` (three.js, browser)

| File | Responsibility |
| --- | --- |
| `interp.ts` | Buffers frames, renders ~150 ms in the past and interpolates |
| `line.ts` | Table, belt, movers and stations |
| `station.ts` | One station: gate pin, stack light, label and its equipment |
| `devices.ts` | Robot, camera, feeder, nest, tray, bin and scrap views |
| `movers.ts` | Movers with printed numbers, pen assemblies, parts held by grippers |
| `build.ts`, `stage.ts`, `models.ts`, `textures.ts` | Materials and geometry helpers, renderer/camera/lights, glTF loading, canvas textures (numbers, DataMatrix) |
| `hud.ts` | HTML controls, KPIs, batch panel, fault injection, event log, mover inspector, connection state |

### `src/catchai` (reporting, runs on the server)

| File | Responsibility |
| --- | --- |
| `catalogue.ts` | The line as CATCH.AI sees it: devices, processes, properties, events, item view |
| `setup.ts` | Creates what's missing before data is sent; finds our property/event keys and the scoped id base |
| `mapper.ts` | Sim events → `ItemProcessed` / `ItemsMerged` / device data / batch periods |
| `reporter.ts` | Queue, ordering, bulk sends, retries |
| `api.ts`, `types.ts` | fetch wrapper and the REST contracts |

To report, put the API key in `.env.local` (git-ignored), or set it in the environment:

```sh
CATCHAI_API_KEY=...
# CATCHAI_URL=https://...   optional, defaults to the demo server
```

The server calls CATCH.AI directly, so the key never reaches a browser. With a key, reporting is
on from startup. The **CATCH.AI** button in the top bar turns it on/off for the line, so every
viewer sees the change. The setting resets when the server restarts. See
[docs/PLAN.md §10d](docs/PLAN.md).

## 3D models

Parts and movers are generated by a Blender script, so they're reproducible:

```sh
blender -b -P tools/blender/parts.py -- public --no-render   # writes public/models/*.glb
```

Belts, frames, robots and feeders are built procedurally in `src/view`.

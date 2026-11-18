# Pen Assembly Line Simulator

A 3D simulation of a pharma (pen-injector) assembly line, modelled on the C# simulator's line
(units UN01–UN03, stations EM00–EM61). Movers ride a friction belt, stop at gates, and get
worked on by pick-and-place robots. Parts come from sub-lines with their own checks: springs
(EM10), spring bases (EM13 onto a conveyor feeding four presses, EM14A–D), labelled housings
from a dial (EM30–EM32) and cartridges de-nested into collets (EM00). Inspections reject about
17–20 % of pens, as the original line's quality figures give. Every station reports
`ItemProcessed` / `ItemsMerged` records with real timings. See [docs/PLAN.md](docs/PLAN.md) for the
first version's design and [docs/PLAN-v2.md](docs/PLAN-v2.md) for the full line.

The simulation runs on a Node server and is streamed to browsers over a WebSocket. The browser
only renders the line in 3D and sends operator commands. Every browser sees the same line, and
the line keeps running with no browser open.

```sh
npm install
npm run dev        # http://localhost:5173: server + simulation, frontend with hot reload
npm test           # headless simulation, streaming and server tests
npm run build      # typecheck + production build into dist/client and dist/server
npm start          # run the production build on http://localhost:3000
npx tsx tools/scripts/calibrate.ts   # headless calibration runs: throughput, faults, reject rates
```

`npm run dev` runs the server with [tsx](https://tsx.is) in watch mode, with Vite inside it for
the frontend. Changes under `src/view` reload the page. Changes to the simulation or the server
restart the server, which also restarts the simulation. The page reconnects by itself.

## Running in production

The server needs Node 22 or later. The build produces two parts:

- `dist/client`: the static frontend.
- `dist/server/index.js`: the server, bundled into one file. At runtime it needs the `ws` package from `node_modules`, plus `puppeteer` and `ffmpeg-static` if it streams cameras over RTSP (see [RTSP camera streams](#rtsp-camera-streams)).

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
| `CATCHAI_AUTH` | – | Set to `none` for a CATCH.AI server with authentication off: reporting starts without an API key |
| `CLIENT_DIR` | `dist/client` | Directory of the built frontend |
| `LOG_REQUESTS` | off | Set to `1` to log every HTTP request. Viewer connects and disconnects are always logged |
| `RTSP_CAMERAS` | – | Cameras to stream over RTSP: comma-separated ids (`infeed,outfeed`) or `all`. Off when empty |
| `RTSP_PORT` | `18554` | RTSP port of the bundled MediaMTX (RTP/RTCP over UDP use the next two ports: `18556`, `18557`) |
| `RTSP_PUBLISH_URL` | – | Publish to an existing RTSP server instead (e.g. the VMS's MediaMTX): `rtsp://[user:pass@]host:8554/simulator`. The camera id is appended |
| `RTSP_TIMESTAMP` | off | Set to `1` to burn the wall-clock time (ISO 8601, UTC, ms) into the picture, for debugging |
| `RTSP_CHROME_ARGS` | – | Extra Chrome flags, space-separated (e.g. to choose the GPU backend) |
| `MEDIAMTX_PATH` / `FFMPEG_PATH` | bundled | Use these binaries instead of the bundled ones |

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

## Cameras and controls

The view has six monitoring cameras. Pick one with the bar at the bottom or with keys **1–6**:

| Key | Camera | Shows |
| --- | --- | --- |
| 1 | Overview | The whole line, framed to the window |
| 2 | Infeed | EM10 checking springs on their track, EM11 body load + spring (two arms on one gantry), EM12 spring angle |
| 3 | Spring base | EM13 turning spring bases onto the distribution conveyor, the four EM14 presses side by side, EM15 |
| 4 | Cartridge | EM00 taking cartridges out of a 160-pocket nest into collets, the collet loop, EM41 inserting them |
| 5 | Housing | The housing dial (EM30 load, EM31 label with the pen's DataMatrix, EM32 label check) and EM40 snapping the housing on |
| 6 | Outfeed | EM60 packing trays of 32 from the destacker, EM61 checking each tray, the outfeed stack and reject rack |

The fixed cameras are defined in `src/view/cameras.ts`, in each station's own coordinates, so
they stay on their station if the layout changes. You can still orbit and zoom with the mouse.
The view then becomes a free view until you pick a camera again.

**Auto-hide** (button or **H**) hides the controls after 3 s without input, and moving the mouse
brings them back. While they're hidden, the view shows only the camera name and time, like a
monitoring feed. CATCH.AI alerts stay visible. The chosen camera and the auto-hide setting are
remembered in the browser.

For a wall display, open `/?cam=cartridge&ui=hidden`. `cam` is a camera id (`overview`,
`infeed`, `springbase`, `cartridge`, `housing`, `outfeed`). `ui=hidden` starts with the controls hidden and
auto-hide on.

## RTSP camera streams

The server can publish the camera views as RTSP streams for a VMS: H.264 (Main), 1280×720,
25 fps, a keyframe every 2 s, no B-frames, about 4 Mbit/s. The end-to-end delay is about 0.3 s.

```sh
RTSP_CAMERAS=infeed npm start      # → rtsp://<server>:18554/infeed
```

```
 headless Chrome                         ffmpeg                    MediaMTX
 /?cam=infeed&capture=1  ──WebM chunks──▶ libx264 720p25 ──RTSP──▶ :18554/infeed ──▶ VMS
 (canvas → MediaRecorder)
```

- **Everything is installed by `npm install`:** Puppeteer downloads Chrome into `.cache/puppeteer`, `ffmpeg-static` brings ffmpeg, and a postinstall script downloads MediaMTX (pinned, checksum-verified) into `vendor/mediamtx`. To fetch MediaMTX again, run `npm run fetch:mediamtx`. To skip it, set `MEDIAMTX_SKIP_DOWNLOAD=1`.
- **Each camera is one page** in a shared headless Chrome. The page (`/?cam=<id>&capture=1`, `src/view/capture.ts`) renders on a fixed 25 fps clock and records its canvas with MediaRecorder. The server pipes the recording into ffmpeg, which re-encodes it and publishes it to MediaMTX. Open that URL in a normal browser to see exactly what the stream shows.
- **The bundled MediaMTX serves only RTSP**, on ports that don't clash with a stock MediaMTX (8554/8000/8001), so it can run next to the VMS's MediaMTX. All its other protocols are off. Only this machine may publish, and anyone may read. Open TCP `18554` (and UDP `18556`–`18557` for RTP over UDP) in the firewall. To use the VMS's MediaMTX instead, set `RTSP_PUBLISH_URL`. The bundled one then doesn't start.
- **Supervised:** if Chrome, a page, ffmpeg or MediaMTX dies, or a camera sends no video for 20 s, that part is restarted with a backoff (1 s, doubling, at most 30 s).
- **GPU:** the log shows which GPU Chrome renders with (`camera infeed: WebGL renderer: …`). If it says SwiftShader, llvmpipe or *Microsoft Basic Render Driver*, Chrome has fallen back to software rendering, and the stream will stutter. On Windows this can happen when the server runs as a service (session 0). Run it in a logged-in session instead (for example, a Task Scheduler task at logon), or try `RTSP_CHROME_ARGS=--use-angle=d3d11`.
- **Cost (Apple M4):** about 30 % of one CPU core per camera across Chrome, ffmpeg and MediaMTX.

## How it fits together

```
 Node server (host, src/server)                     WebSocket /ws      Browser (any number)
┌──────────────────────────────────────────────┐    frames ~30 Hz    ┌───────────────────────────┐
│ Plant (truth) ◄─ sensors / actuators ─► PLC  │ ──────────────────► │ FrameBuffer → three.js     │
│  movers, belt, gates,              machine + │    events, status   │ view + HUD                 │
│  robots, cameras, feeders,         stations  │ ──────────────────► │                            │
│  sub-lines, tray, faults           → MES ──► CATCH.AI reporter     │ ◄── commands (start, …)    │
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
| `cameras.ts` | RTSP camera streams: headless Chrome page and ffmpeg per camera, supervised |
| `mediamtx.ts` | The bundled MediaMTX: config, start, restart |

### `src/sim` (headless, no DOM, runs on the server)

| File | Responsibility |
| --- | --- |
| `config.ts` | Line layout, stations, timings, quality model, faults, batch settings |
| `types.ts` | Serializable state types |
| `simulation.ts` | `Simulation`: steps plant + PLC, applies commands, drains events |
| `plant.ts` | Movers on the belt, gates, RFID readers, cameras; sensor image for the PLC |
| `robot.ts` | Cartesian robots: job programs (prepick/place/pickMover/drop), axis motion, grip/release effects |
| `devices.ts` | Bowl feeders (with EM10's inline check), tray outfeed, random-failure helpers |
| `sublines.ts` | EM13 spring base orienter and the distribution conveyor to EM14A–D |
| `dial.ts` | The housing dial: EM30 load, EM31 label, EM32 label check |
| `cartridges.ts` | Nests of 160, EM00 de-nesting into collets, the collet loop to EM41 |
| `snap.ts` | EM40's snap curve and judging it |
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
| `devices.ts` | Robot, camera, feeder, tray, bin and scrap views |
| `sublines.ts` | Spring base line (EM13, conveyor, cups), housing dial, cartridge cell (nests, EM00, collets) |
| `movers.ts` | Movers with printed numbers, pen assemblies, parts held by grippers |
| `build.ts`, `stage.ts`, `models.ts`, `textures.ts` | Materials and geometry helpers, renderer/camera/lights, glTF loading, canvas textures (numbers, DataMatrix) |
| `hud.ts` | HTML controls, KPIs, batch panel, fault injection, event log, mover inspector, connection state |
| `cameras.ts`, `monitor.ts` | Fixed monitoring cameras; camera selector, keys, auto-hide and camera label |
| `capture.ts` | Capture mode for the RTSP streams: fixed-rate rendering, optional timestamp, MediaRecorder |

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

When reporting isn't getting through, the chip shows a short reason, and an alert under the top
bar explains what's wrong and what to check:

| Reason | Shown as | Typical cause |
| --- | --- | --- |
| No API key on the server | *not configured* | `CATCHAI_API_KEY` missing; nothing is sent |
| No answer (DNS, refused, timeout after 30 s, TLS) | *no connection* | Network, firewall/proxy, wrong `CATCHAI_URL` |
| 401 / 403 | *key rejected* | Wrong or revoked key |
| 5xx, 429, 408 | *server error* | CATCH.AI down or overloaded, usually temporary |
| Other 4xx during setup | *setup failed* | See the server log |

While it's failing, the server keeps the data and retries with backoff (up to 30 s apart). The
alert shows how many records are waiting and when the next retry is. The data is sent when the
connection is back, and only the oldest data is dropped if more than 100,000 records pile up.
The server log has one line when a problem starts or changes, and one when it's resolved.

## 3D models

Parts and movers are generated by a Blender script, so they're reproducible:

```sh
blender -b -P tools/blender/parts.py -- public --no-render   # writes public/models/*.glb
```

Belts, frames, robots and feeders are built procedurally in `src/view`.

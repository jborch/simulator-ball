// The bundled MediaMTX RTSP server (downloaded by tools/scripts/fetch-mediamtx.mjs on npm install).
// It only speaks RTSP, on its own ports so it can share a host with another MediaMTX (e.g. a
// VMS's, which uses the defaults 8554/8000/8001). Only this machine may publish; anyone may read.
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface MediaMtxOptions {
  /** RTSP port. RTP/RTCP (UDP transport) use the next even/odd pair above it. */
  port: number;
  /** Project root (for vendor/mediamtx). */
  root: string;
  /** Overrides the bundled binary. */
  binary?: string;
  log: (msg: string) => void;
}

export function mediaMtxBinary(root: string, override?: string): string {
  return override || path.join(root, 'vendor', 'mediamtx', process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx');
}

export function mediaMtxConfig(port: number): string {
  const rtp = (port + 2) & ~1;
  return `# Written by simulator-ball on every start; edits are overwritten.
logLevel: info
logDestinations: [stdout]
api: false
metrics: false
pprof: false
playback: false
rtmp: false
hls: false
webrtc: false
srt: false
moq: false
rtsp: true
rtspTransports: [udp, tcp]
rtspAddress: :${port}
rtpAddress: :${rtp}
rtcpAddress: :${rtp + 1}
authMethod: internal
authInternalUsers:
  - user: any
    pass:
    ips: ['127.0.0.1', '::1']
    permissions:
      - action: publish
        path:
  - user: any
    pass:
    ips: []
    permissions:
      - action: read
        path:
paths:
  all_others:
`;
}

/** Runs MediaMTX, restarting it if it exits. */
export class MediaMtx {
  private child: ChildProcess | null = null;
  private stopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  constructor(private readonly opts: MediaMtxOptions) {}

  /** Starts MediaMTX and resolves once it accepts connections. */
  async start(): Promise<void> {
    const binary = mediaMtxBinary(this.opts.root, this.opts.binary);
    if (!existsSync(binary)) throw new Error(`MediaMTX not found at ${binary}. Run \`npm run fetch:mediamtx\`, or set RTSP_PUBLISH_URL to publish to an existing MediaMTX.`);
    // Otherwise the readiness check below would happily connect to whoever has the port.
    if (!(await portFree(this.opts.port))) throw new Error(`RTSP port ${this.opts.port} is already in use (another MediaMTX?). Set RTSP_PORT to a free port, or RTSP_PUBLISH_URL to publish to that server.`);
    this.spawn(binary);
    await waitForPort(this.opts.port, 10_000, () => this.child === null);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.child?.kill();
    this.child = null;
  }

  private spawn(binary: string): void {
    const config = path.join(os.tmpdir(), `simulator-ball-mediamtx-${this.opts.port}.yml`);
    writeFileSync(config, mediaMtxConfig(this.opts.port));
    const child = spawn(binary, [config], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    const started = Date.now();
    const relay = (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) if (line.trim()) this.opts.log(`mediamtx: ${line.replace(/^\S+ \S+ /, '')}`);
    };
    child.stdout!.on('data', relay);
    child.stderr!.on('data', relay);
    child.on('error', (err) => this.opts.log(`mediamtx: ${err.message}`));
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.failures = Date.now() - started > 60_000 ? 1 : this.failures + 1;
      const delay = Math.min(30_000, 1000 * 2 ** (this.failures - 1));
      this.opts.log(`mediamtx exited (${signal ?? code}); restarting in ${delay / 1000} s`);
      this.restartTimer = setTimeout(() => this.spawn(binary), delay);
    });
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

/** Resolves when something accepts TCP connections on localhost:port. */
export async function waitForPort(port: number, timeoutMs: number, gaveUp: () => boolean = () => false): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect({ port, host: '127.0.0.1' });
      s.once('connect', () => (s.destroy(), resolve(true)));
      s.once('error', () => resolve(false));
    });
    if (ok) return;
    if (gaveUp() || Date.now() > deadline) throw new Error(`nothing listening on port ${port}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

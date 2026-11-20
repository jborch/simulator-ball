// RTSP camera streams: a headless Chrome on the server opens one page per camera
// (`/?cam=<id>&capture=1`, see src/view/capture.ts), which records its canvas with MediaRecorder and
// hands the chunks to us. ffmpeg re-encodes them to H.264 (720p, 25 fps, fixed GOP, no B-frames,
// which VMSs handle best) and publishes the result to MediaMTX, which serves it over RTSP.
//
//   Chrome page ──MediaRecorder chunks──▶ ffmpeg (libx264) ──RTSP publish──▶ MediaMTX ──▶ VMS
//
// Each camera is supervised on its own: if its page, the browser or its ffmpeg dies, or no video
// arrives for a while, the feed is torn down and restarted with a backoff.
import { type ChildProcess, spawn } from 'node:child_process';
import type { Browser, Page } from 'puppeteer';

export const STREAM = { width: 1280, height: 720, fps: 25, bitrateKbps: 4000 } as const;
/**
 * Bit rate with camera realism on: about what an IP camera spends on 720p. With sensor noise in the
 * picture, that is low enough to show the usual compression artefacts (blocking, smeared detail).
 */
export const REALISTIC_BITRATE_KBPS = 1500;

export interface CameraStreamsOptions {
  /** Camera ids (see src/view/cameras.ts). */
  cameras: string[];
  /** Where the headless browser loads the app, e.g. http://127.0.0.1:3000 */
  appUrl: string;
  /** RTSP base URL to publish to; the camera id is appended as the path. */
  publishUrl: string;
  /** Burn an ISO 8601 timestamp into the picture. */
  timestamp: boolean;
  /** Make the picture look like a real camera's (see src/view/camerafx.ts). */
  realism: boolean;
  bitrateKbps: number;
  ffmpegPath: string;
  /** Extra Chrome flags (e.g. to pick a GPU backend). */
  chromeArgs?: string[];
  log: (msg: string) => void;
}

/** A feed that produced no video for this long is restarted (first start includes model loading). */
const STALL_MS = 20_000;
/** ffmpeg warnings that are expected for a MediaRecorder stream. */
const HARMLESS_FFMPEG = /not enough frames to estimate rate/;
/** A feed that ran this long counts as healthy again, so the next failure restarts it quickly. */
const HEALTHY_MS = 60_000;

const CHROME_ARGS = [
  // Keep rendering and timers at full speed although nobody looks at the page.
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  // Use the GPU even if Chrome doesn't trust its driver; WebGL in software is far too slow.
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];

/** `RTSP_CAMERAS`: comma-separated camera ids, or `all`. Throws on an unknown id. */
export function parseCameraList(value: string | undefined, known: readonly string[]): string[] {
  const ids = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.includes('all')) return [...known];
  const unknown = ids.filter((id) => !known.includes(id));
  if (unknown.length) throw new Error(`unknown camera ${unknown.join(', ')} in RTSP_CAMERAS (cameras: ${known.join(', ')}, or all)`);
  return [...new Set(ids)];
}

/** Hides the password in an rtsp://user:pass@host URL. */
export function redact(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@/]*@/, '//$1:***@');
}

export function publishTarget(base: string, camera: string): string {
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(camera)}`;
}

export function captureUrl(appUrl: string, camera: string, timestamp: boolean, realism = false): string {
  const url = new URL('/', appUrl);
  url.search = new URLSearchParams({ cam: camera, capture: '1', fps: String(STREAM.fps), ...(timestamp ? { ts: '1' } : {}), ...(realism ? { fx: '1' } : {}) }).toString();
  return url.toString();
}

export function ffmpegArgs(target: string, bitrateKbps: number = STREAM.bitrateKbps): string[] {
  const { fps, width, height } = STREAM;
  return [
    ...['-hide_banner', '-loglevel', 'warning', '-nostats'],
    // Input: the Matroska/WebM stream from MediaRecorder, as it arrives. Its header carries the
    // codec setup, so there's little to probe; decode without frame threading for low delay.
    // (Not `-fflags nobuffer`: with it, ffmpeg probes the full default 5 s before starting.)
    ...['-probesize', '65536', '-analyzeduration', '0', '-flags', 'low_delay', '-threads', '1'],
    ...['-f', 'matroska', '-i', 'pipe:0'],
    // Constant frame rate and size, whatever the browser managed to deliver.
    ...['-an', '-vf', `fps=${fps},scale=${width}:${height}:flags=bicubic,format=yuv420p`],
    ...['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main'],
    // A keyframe every 2 s, so a VMS that connects mid-stream gets a picture quickly.
    ...['-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0', '-bf', '0'],
    ...['-b:v', `${bitrateKbps}k`, '-maxrate', `${bitrateKbps}k`, '-bufsize', `${bitrateKbps}k`],
    // Packets that fit MediaMTX's UDP payload limit, so it doesn't have to split them.
    ...['-f', 'rtsp', '-rtsp_transport', 'tcp', '-pkt_size', '1400', target],
  ];
}

export class CameraStreams {
  private browser: Promise<Browser> | null = null;
  private readonly feeds: CameraFeed[];
  stopped = false;

  constructor(readonly opts: CameraStreamsOptions) {
    this.feeds = opts.cameras.map((id) => new CameraFeed(this, id));
  }

  start(): void {
    for (const feed of this.feeds) feed.start();
  }

  /** Synchronous part of stop(), for process exit: kills the ffmpeg processes. */
  stopNow(): void {
    this.stopped = true;
    for (const feed of this.feeds) feed.stop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const feed of this.feeds) feed.stop();
    const browser = await this.browser?.catch(() => null);
    this.browser = null;
    await browser?.close().catch(() => {});
  }

  /** The shared headless Chrome, launched on first use and again after it dies. */
  getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const launching = (async () => {
        const { default: puppeteer } = await import('puppeteer');
        const browser = await puppeteer.launch({
          headless: true,
          args: [...CHROME_ARGS, ...(this.opts.chromeArgs ?? [])],
          // We stop Chrome ourselves on shutdown (index.ts); Puppeteer still kills it if Node exits.
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
        });
        this.opts.log(`cameras: started ${await browser.version()}`);
        browser.on('disconnected', () => {
          if (this.browser === launching) this.browser = null;
          if (!this.stopped) this.opts.log('cameras: browser exited');
        });
        return browser;
      })();
      this.browser = launching;
      launching.catch(() => {
        if (this.browser === launching) this.browser = null;
      });
    }
    return this.browser;
  }
}

class CameraFeed {
  private run = 0;
  private failures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private teardown: (() => void) | null = null;
  private readonly target: string;

  constructor(
    private readonly owner: CameraStreams,
    private readonly id: string,
  ) {
    this.target = publishTarget(owner.opts.publishUrl, id);
  }

  private log(msg: string): void {
    this.owner.opts.log(`camera ${this.id}: ${msg}`);
  }

  start(): void {
    void this.launch();
  }

  stop(): void {
    this.run++;
    clearTimeout(this.restartTimer);
    this.teardown?.();
    this.teardown = null;
  }

  private async launch(): Promise<void> {
    const run = ++this.run;
    const { opts } = this.owner;
    const startedAt = Date.now();
    let ffmpeg: ChildProcess | null = null;
    let page: Page | null = null;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastChunk = Date.now();
    let streaming = false;

    let browser: Browser | null = null;
    const onBrowserGone = () => fail('browser exited');
    const teardown = () => {
      clearInterval(watchdog);
      browser?.off('disconnected', onBrowserGone);
      ffmpeg?.stdin?.destroy();
      ffmpeg?.kill();
      void page?.close().catch(() => {});
    };
    this.teardown = teardown;
    const fail = (why: string) => {
      if (run !== this.run || this.owner.stopped) return;
      this.run++;
      teardown();
      this.teardown = null;
      this.failures = Date.now() - startedAt > HEALTHY_MS ? 1 : this.failures + 1;
      const delay = Math.min(30_000, 1000 * 2 ** (this.failures - 1));
      this.log(`${why}; restarting in ${delay / 1000} s`);
      this.restartTimer = setTimeout(() => void this.launch(), delay);
    };

    try {
      ffmpeg = spawn(opts.ffmpegPath, ffmpegArgs(this.target, opts.bitrateKbps), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      ffmpeg.on('error', (err) => fail(`ffmpeg: ${err.message}`));
      ffmpeg.on('exit', (code, signal) => fail(`ffmpeg exited (${signal ?? code})`));
      ffmpeg.stdin!.on('error', () => {}); // a broken pipe shows up as the exit above
      ffmpeg.stderr!.on('data', (data: Buffer) => {
        if (run !== this.run) return; // complaints about the input ending as the feed is torn down
        for (const line of data.toString().split(/\r?\n/)) {
          if (line.trim() && !HARMLESS_FFMPEG.test(line)) this.log(`ffmpeg: ${redact(line.trim())}`);
        }
      });
      const stdin = ffmpeg.stdin!;

      browser = await this.owner.getBrowser();
      if (run !== this.run) return teardown();
      // A crashed browser doesn't close its pages, so watch the browser itself too.
      browser.on('disconnected', onBrowserGone);
      page = await browser.newPage();
      if (run !== this.run) return teardown();
      page.on('error', (err) => fail(`page crashed: ${err.message}`));
      page.on('close', () => fail('page closed'));
      page.on('pageerror', (err) => this.log(`page error: ${err instanceof Error ? err.message : String(err)}`));
      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warn' || text.startsWith('[capture]')) this.log(text.replace(/^\[capture\] /, ''));
      });
      await page.setViewport({ width: STREAM.width, height: STREAM.height, deviceScaleFactor: 1 });
      await page.exposeFunction('__cameraChunk', async (base64: string) => {
        if (run !== this.run) return;
        lastChunk = Date.now();
        if (!streaming) {
          streaming = true;
          this.log(`streaming to ${redact(this.target)}`);
        }
        // Resolving late (when ffmpeg can't keep up) slows the page's queue instead of buffering here.
        if (!stdin.write(Buffer.from(base64, 'base64'))) {
          await new Promise<void>((resolve) => {
            const done = () => {
              stdin.off('drain', done);
              stdin.off('close', done);
              resolve();
            };
            stdin.on('drain', done);
            stdin.on('close', done);
          });
        }
      });
      lastChunk = Date.now();
      watchdog = setInterval(() => {
        if (Date.now() - lastChunk > STALL_MS) fail(`no video for ${STALL_MS / 1000} s`);
      }, 1000);
      await page.goto(captureUrl(opts.appUrl, this.id, opts.timestamp, opts.realism), { waitUntil: 'load', timeout: 30_000 });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }
}

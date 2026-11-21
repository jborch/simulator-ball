// Camera-feed capture (`?capture=1`): the server's headless Chrome opens the page this way to turn
// one camera view into an RTSP stream (see src/server/cameras.ts). The page renders on a fixed
// clock instead of requestAnimationFrame, copies each frame (plus an optional ISO 8601 timestamp)
// onto a 2D canvas, and MediaRecorder encodes that canvas. The encoded chunks go to the server
// through `window.__cameraChunk`, a function Puppeteer exposes; the server re-encodes them to
// H.264 with ffmpeg and publishes them to MediaMTX.
// Opened in a normal browser, capture mode just shows the bare feed (handy for checking framing).

declare global {
  interface Window {
    /** Exposed by the server's Puppeteer page. Resolves once the chunk is written (backpressure). */
    __cameraChunk?: (base64: string) => Promise<void>;
    /** Exposed when the server relays object boxes (RTSP_OBJECTS=1); see oracle.ts. */
    __cameraObjects?: (json: string) => Promise<void>;
  }
}

export interface CaptureParams {
  fps: number;
  /** Burn the wall-clock time (ISO 8601, UTC, ms) into the top-left corner. */
  timestamp: boolean;
}

export function captureParams(search = location.search): CaptureParams | null {
  const params = new URLSearchParams(search);
  if (params.get('capture') !== '1') return null;
  const fps = Number(params.get('fps') ?? 25);
  return { fps: Number.isFinite(fps) && fps >= 1 && fps <= 60 ? fps : 25, timestamp: params.get('ts') === '1' };
}

/** High enough that the re-encode on the server sees little loss from this first encode. */
const INTERMEDIATE_BPS = 16_000_000;
/** How often MediaRecorder hands over a chunk. Keeps latency low without flooding the bridge. */
const CHUNK_MS = 40;
/** Preferred intermediate codecs: H.264 may be hardware-encoded; VP8 always works. */
const MIME_TYPES = ['video/x-matroska;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'];

export class CaptureFeed {
  private readonly out = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly track: CanvasCaptureMediaStreamTrack;
  private sending: Promise<void> = Promise.resolve();

  constructor(
    private readonly source: HTMLCanvasElement,
    private readonly params: CaptureParams,
  ) {
    this.out.width = source.width;
    this.out.height = source.height;
    this.ctx = this.out.getContext('2d', { alpha: false })!;
    // Frame rate 0: a frame is captured only when requestFrame() is called, once per render.
    const stream = this.out.captureStream(0);
    this.track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    logRenderer(source);

    const push = window.__cameraChunk;
    if (!push) return; // a normal browser: just show the feed
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('[capture] MediaRecorder supports none of ' + MIME_TYPES.join(', '));
    console.info(`[capture] ${source.width}x${source.height} @ ${params.fps} fps, ${mimeType}`);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: INTERMEDIATE_BPS });
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      // In order, one at a time: the server's write resolves when ffmpeg has taken the data.
      this.sending = this.sending.then(() => toBase64(e.data)).then(push).catch((err) => console.error(`[capture] ${err}`));
    };
    recorder.onerror = (e) => console.error(`[capture] recorder error: ${(e as ErrorEvent).message ?? e.type}`);
    recorder.start(CHUNK_MS);
  }

  /** Call right after the WebGL render, while its drawing buffer still holds the frame. */
  frame(): void {
    if (this.out.width !== this.source.width || this.out.height !== this.source.height) {
      this.out.width = this.source.width;
      this.out.height = this.source.height;
    }
    this.ctx.drawImage(this.source, 0, 0);
    if (this.params.timestamp) this.drawTimestamp(new Date().toISOString());
    this.track.requestFrame();
  }

  private drawTimestamp(text: string): void {
    const ctx = this.ctx;
    const size = Math.round(this.out.height / 30);
    ctx.font = `600 ${size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    const pad = Math.round(size * 0.35);
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(size * 0.6, size * 0.6, w + pad * 2, size + pad * 2);
    ctx.fillStyle = '#f2f4f7';
    ctx.fillText(text, size * 0.6 + pad, size * 0.6 + pad + size * 0.05);
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Logs the GPU behind WebGL, so the server log shows whether Chrome fell back to software. */
function logRenderer(canvas: HTMLCanvasElement): void {
  const gl = canvas.getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  console[software ? 'warn' : 'info'](`[capture] WebGL renderer: ${renderer}${software ? ' (software rendering: expect a low frame rate)' : ''}`);
}

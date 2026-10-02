// All units are device pixels and per-frame steps at 1× speed.
export const CONFIG = {
  ball: {
    radius: 24,
    // Frames to cross the world at 1× (≈0.75 s on a 240 Hz screen).
    crossFrames: 180,
    angleRangeDeg: 45,
    gapFrames: 8,
    trailLength: 24,
  },
  head: {
    width: 18,
    height: 44,
    speed: 0.5,
  },
  detector: {
    // Must exceed the ball diameter: ball speed is clamped to width - 2·radius so a clean hit is always drawn.
    width: 64,
    height: 120,
    speed: 0.7,
  },
  graph: {
    heightFraction: 0.2,
    // Headroom above the clean-hit line so it stays visible.
    headroom: 1.15,
    lineWidth: 2,
  },
  speeds: [1, 0.5, 0.25],
  controls: {
    autoHideMs: 2000,
  },
  // Credentials are set from the browser console: catchai.connect('<apiKey>', '<url?>').
  catchAi: {
    defaultUrl: 'http://localhost:30000',
    deviceId: 'BallSim1',
    storageKey: 'catchai.connection',
    batchIntervalMs: 100,
    maxBatchSize: 5000,
    queueCap: 50000,
    retryMinMs: 1000,
    retryMaxMs: 30000,
    properties: {
      headY: { Key: 'p600', Name: 'HeadY', Type: 'Float', Unit: 'px' },
      shotAngle: { Key: 'p601', Name: 'ShotAngle', Type: 'Float', Unit: 'deg' },
      detectorY: { Key: 'p602', Name: 'DetectorY', Type: 'Float', Unit: 'px' },
      ballX: { Key: 'p603', Name: 'BallX', Type: 'Float', Unit: 'px' },
      ballY: { Key: 'p604', Name: 'BallY', Type: 'Float', Unit: 'px' },
      overlap: { Key: 'p605', Name: 'Overlap', Type: 'Integer', Unit: 'px' },
      // Float: speed-weighted sum can be fractional at 1/2× and 1/4×.
      totalOverlap: { Key: 'p606', Name: 'TotalOverlap', Type: 'Float', Unit: 'px' },
    },
    events: {
      ballFired: { Key: 'e600', Name: 'BallFired' },
      ballExited: { Key: 'e601', Name: 'BallExited' },
    },
  },
  colors: {
    background: '#1e2127',
    graphBackground: '#171a1f',
    divider: '#3b4252',
    head: '#81a1c1',
    detector: '#4c6a5a',
    detectorActive: '#a3be8c',
    ball: '#d8dee9',
    ballOverlap: '#ebcb8b',
    trail: '216, 222, 233',
    graphLine: '#88c0d0',
    cleanHitLine: '#bf616a',
  },
} as const;

export type Config = typeof CONFIG;

/** Returns an error message if the config makes a clean hit impossible, otherwise null. */
export function validateConfig(cfg: {
  ball: { radius: number };
  detector: { width: number; height: number };
}): string | null {
  const d = 2 * cfg.ball.radius;
  if (cfg.detector.width <= d || cfg.detector.height < d) {
    return `Invalid config: detector (${cfg.detector.width}×${cfg.detector.height}) must be wider than and at least as tall as the ball diameter (${d}).`;
  }
  return null;
}

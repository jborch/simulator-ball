import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { CatchAiReporter } from './reporter';
import type { DeviceData } from './types';

const cfg = CONFIG.catchAi;
const p = cfg.properties;
const now = () => new Date('2026-10-02T12:00:00.000Z');

function capture() {
  const records: DeviceData[] = [];
  return { records, reporter: new CatchAiReporter((r) => records.push(r), cfg, now) };
}

describe('CatchAiReporter', () => {
  it('maps a fired ball to one record with the event and its properties', () => {
    const { records, reporter } = capture();
    reporter.onBallFired({ shot: 3, headY: 100, angleDeg: 12.5, detectorY: 400 });
    expect(records).toEqual([
      {
        DeviceId: cfg.deviceId,
        Logged: '2026-10-02T12:00:00.000Z',
        Events: { [cfg.events.ballFired.Key]: 3 },
        Properties: { [p.headY.Key]: 100, [p.shotAngle.Key]: 12.5, [p.detectorY.Key]: 400 },
      },
    ]);
  });

  it('maps flight samples to position and overlap properties', () => {
    const { records, reporter } = capture();
    reporter.onBallFlight({ shot: 1, x: 10, y: 20, overlap: 7 });
    expect(records[0].Properties).toEqual({ [p.ballX.Key]: 10, [p.ballY.Key]: 20, [p.overlap.Key]: 7 });
    expect(records[0].Events).toBeUndefined();
  });

  it('maps an exited ball to the exit event and total overlap', () => {
    const { records, reporter } = capture();
    reporter.onBallExited({ shot: 2, totalOverlap: 1234 });
    expect(records[0].Events).toEqual({ [cfg.events.ballExited.Key]: 2 });
    expect(records[0].Properties).toEqual({ [p.totalOverlap.Key]: 1234 });
  });
});

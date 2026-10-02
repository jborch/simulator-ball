import { CONFIG } from '../config';
import type { BallExited, BallFired, BallFlight, SimEvents } from '../events';
import type { DeviceData } from './types';

type CatchAiConfig = typeof CONFIG.catchAi;

/** Maps simulation events to CATCH.AI device-data records. */
export class CatchAiReporter implements SimEvents {
  constructor(
    private readonly sink: (record: DeviceData) => void,
    private readonly cfg: CatchAiConfig = CONFIG.catchAi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  onBallFired(e: BallFired): void {
    const p = this.cfg.properties;
    this.emit({
      Events: { [this.cfg.events.ballFired.Key]: e.shot },
      Properties: { [p.headY.Key]: e.headY, [p.shotAngle.Key]: e.angleDeg, [p.detectorY.Key]: e.detectorY },
    });
  }

  onBallFlight(e: BallFlight): void {
    const p = this.cfg.properties;
    this.emit({ Properties: { [p.ballX.Key]: e.x, [p.ballY.Key]: e.y, [p.overlap.Key]: e.overlap } });
  }

  onBallExited(e: BallExited): void {
    this.emit({
      Events: { [this.cfg.events.ballExited.Key]: e.shot },
      Properties: { [this.cfg.properties.totalOverlap.Key]: e.totalOverlap },
    });
  }

  private emit(data: Pick<DeviceData, 'Properties' | 'Events'>): void {
    this.sink({ DeviceId: this.cfg.deviceId, Logged: this.now().toISOString(), ...data });
  }
}

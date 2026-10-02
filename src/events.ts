// Domain events emitted by the simulation; positions are centers in device px with y pointing down.
export interface BallFired {
  shot: number;
  headY: number;
  /** Degrees, positive = upward. */
  angleDeg: number;
  detectorY: number;
}

export interface BallFlight {
  shot: number;
  x: number;
  y: number;
  overlap: number;
}

export interface BallExited {
  shot: number;
  /** Sum of overlap over the flight, weighted by speed so it is speed-independent. */
  totalOverlap: number;
}

export interface SimEvents {
  onBallFired(e: BallFired): void;
  onBallFlight(e: BallFlight): void;
  onBallExited(e: BallExited): void;
}

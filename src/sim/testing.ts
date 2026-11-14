// Helpers for tests.
import { LINE, type LineConfig } from './config';

/** A copy of the line config without random faults and with a batch that never runs out. */
export function steadyConfig(mutate?: (c: LineConfig) => void): LineConfig {
  const cfg: LineConfig = structuredClone(LINE);
  cfg.faults.enabled = false;
  cfg.batch.size = 1_000_000;
  mutate?.(cfg);
  return cfg;
}

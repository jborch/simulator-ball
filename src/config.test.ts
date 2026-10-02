import { describe, expect, it } from 'vitest';
import { CONFIG, validateConfig } from './config';

describe('validateConfig', () => {
  it('accepts the default config', () => {
    expect(validateConfig(CONFIG)).toBeNull();
  });

  it('rejects a ball wider than the detector', () => {
    const cfg = { ...CONFIG, ball: { ...CONFIG.ball, radius: CONFIG.detector.width } };
    expect(validateConfig(cfg)).toMatch(/detector/);
  });
});

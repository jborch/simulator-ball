import type { EventDefinition, PropertyDefinition } from './types';

// CATCH.AI connection settings. Credentials are set from the browser console:
// catchai.connect('<apiKey>', '<url?>'). Not wired into the line yet; reporting is the next milestone.
export const CATCHAI = {
  defaultUrl: 'http://localhost:30000',
  deviceId: 'L07',
  storageKey: 'catchai.connection',
  batchIntervalMs: 100,
  maxBatchSize: 5000,
  queueCap: 50000,
  retryMinMs: 1000,
  retryMaxMs: 30000,
  /** Device-data definitions created on connect. */
  properties: {} as Record<string, PropertyDefinition>,
  events: {} as Record<string, EventDefinition>,
};

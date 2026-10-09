import { describe, expect, it } from 'vitest';

import { createTelemetrySdk } from './telemetry.js';

describe('createTelemetrySdk', () => {
  it('is switched off when no endpoint is configured', () => {
    expect(createTelemetrySdk(undefined)).toBeUndefined();
  });

  it('builds an SDK when an endpoint is configured', () => {
    expect(createTelemetrySdk('http://localhost:4318')).toBeDefined();
  });
});

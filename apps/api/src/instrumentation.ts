import { register } from 'node:module';

import { loadEnv } from './config/env.js';
import { createTelemetrySdk } from './telemetry.js';

// Loaded with `node --import` before main.js so the libraries are patched before first use.
const sdk = createTelemetrySdk(loadEnv().OTEL_EXPORTER_OTLP_ENDPOINT);
if (sdk !== undefined) {
  // Nest 12 and its dependencies are ES modules: this loader hook lets the instrumentations patch them
  // (require-in-the-middle alone only sees CommonJS).
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}

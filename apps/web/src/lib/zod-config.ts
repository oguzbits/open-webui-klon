import { config } from 'zod';

// The chat stream library (`ai`) validates with zod. By default zod probes `new Function('')` to compile
// parsers; under the strict CSP (no `unsafe-eval`) the browser reports every probe as a violation although zod
// catches the error. Turning the compiler off skips the probe; parsing is only a little slower.
// Imported first in `main.tsx`, before any schema is built.
config({ jitless: true });

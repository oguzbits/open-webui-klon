import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../config/env.js';
import { REDACT_CENSOR, REDACT_PATHS } from '../logging/redact.js';

/** A valid key ring for tests (never used outside them). */
export const TEST_KEY_RING = [`test:${Buffer.alloc(32, 9).toString('base64')}`];

export function configOf(values: Partial<Record<keyof Env, unknown>>): ConfigService<Env, true> {
  return new ConfigService<Env, true>(values);
}

export function silentLogger(): PinoLogger {
  return new PinoLogger({ pinoHttp: { level: 'silent' } });
}

/** Same redaction as the app logger, but the lines stay in memory so a test can search them. */
export function capturingLogger(): { logger: PinoLogger; output: () => string } {
  const lines: string[] = [];
  const logger = new PinoLogger({
    pinoHttp: [
      { level: 'trace', redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    ],
  });
  return { logger, output: () => lines.join('') };
}

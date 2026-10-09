import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { REDACT_CENSOR, REDACT_PATHS } from './redact.js';

describe('REDACT_PATHS', () => {
  it('removes credentials from logged requests but keeps harmless fields', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } },
      {
        write: (line: string) => {
          lines.push(line);
        },
      }
    );

    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer token-abc',
            cookie: 'sid=cookie-1',
            'x-api-key': 'key-123',
            accept: 'text/plain',
          },
        },
        res: { headers: { 'set-cookie': 'sid=cookie-2' } },
        user: { password: 'pw-secret' },
        connection: { apiKey: 'sk-provider-1', apiKeyCiphertext: 'v1.dev.iv.cipher-1' },
        outgoing: {
          authorization: 'Bearer sk-provider-2',
          headers: { authorization: 'Bearer sk-provider-3' },
        },
      },
      'request'
    );

    const output = lines.join('');
    for (const secret of [
      'token-abc',
      'cookie-1',
      'cookie-2',
      'key-123',
      'pw-secret',
      'sk-provider-1',
      'cipher-1',
      'sk-provider-2',
      'sk-provider-3',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('text/plain');
  });
});

import pino from 'pino';
import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { buildDataSourceOptions } from '../database/data-source-options.js';
import { serializeError } from './serialize-error.js';

function logError(error: unknown): string {
  const lines: string[] = [];
  const logger = pino(
    { serializers: { err: serializeError } },
    {
      write: (line: string) => {
        lines.push(line);
      },
    }
  );
  logger.error({ err: error }, 'Unhandled exception');
  return lines.join('');
}

describe('serializeError', () => {
  it('keeps type, message and code but drops the SQL text and its parameters', () => {
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'Key (content)=(secret chat message) already exists.',
    });
    const error = new QueryFailedError(
      'INSERT INTO message(content) VALUES ($1)',
      ['secret chat message'],
      driverError
    );

    const output = logError(error);

    expect(output).toContain('QueryFailedError');
    expect(output).toContain('23505');
    expect(output).not.toContain('secret chat message');
    expect(output).not.toContain('INSERT INTO message');
  });

  it('still logs a plain error with its message', () => {
    expect(logError(new Error('boom'))).toContain('boom');
  });
});

describe('buildDataSourceOptions', () => {
  it('leaves query logging to pino, because the TypeORM console logger prints parameters', () => {
    expect(buildDataSourceOptions('postgresql://u:p@localhost/db').logging).toBe(false);
  });
});

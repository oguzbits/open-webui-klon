import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BASE_TEST_ENV } from '../testing/create-test-app.js';
import { AppConfigModule } from './app-config.module.js';

describe('AppConfigModule against process.env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function configFor(env: Record<string, string>): Promise<ConfigService> {
    for (const [name, value] of Object.entries({ ...BASE_TEST_ENV, ...env })) {
      vi.stubEnv(name, value);
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule.forRoot({ ignoreEnvFile: true })],
    }).compile();
    return moduleRef.get(ConfigService);
  }

  it('hands out the validated value, not the raw text: an empty variable stays unset', async () => {
    // docker compose passes `ADMIN_EMAIL: ${ADMIN_EMAIL:-}`, i.e. an empty string, when nothing is configured.
    const config = await configFor({ ADMIN_EMAIL: '', ADMIN_PASSWORD: '', ADMIN_NAME: '' });

    expect(config.get('ADMIN_EMAIL')).toBeUndefined();
    expect(config.get('ADMIN_PASSWORD')).toBeUndefined();
    expect(config.get('ADMIN_NAME')).toBeUndefined();
  });

  it('hands out booleans and numbers, not strings', async () => {
    const config = await configFor({ ENABLE_API_KEYS: 'false', SESSION_LIFETIME_HOURS: '12' });

    expect(config.get('ENABLE_API_KEYS')).toBe(false);
    expect(config.get('SESSION_LIFETIME_HOURS')).toBe(12);
  });
});

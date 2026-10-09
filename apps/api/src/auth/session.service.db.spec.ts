import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import type { Env } from '../config/env.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { Session } from './session.entity.js';
import { SessionService } from './session.service.js';
import { sha256Hex } from './tokens.js';

describe('SessionService (database)', () => {
  let dataSource: DataSource;
  let service: SessionService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new SessionService(
      dataSource.getRepository(Session),
      new ConfigService<Env, true>({ SESSION_LIFETIME_HOURS: 1 })
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetAuthTables(dataSource);
  });

  it('issues a session and resolves it with its user', async () => {
    const user = await insertUser(dataSource);

    const issued = await service.issue(user.id);
    const resolved = await service.resolve(issued.token);

    expect(resolved?.id).toBe(issued.id);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.csrfToken).toBe(issued.csrfToken);
  });

  it('stores only the hash of the token', async () => {
    const user = await insertUser(dataSource);

    const issued = await service.issue(user.id);

    const row = await dataSource.getRepository(Session).findOneByOrFail({ id: issued.id });
    expect(row.tokenHash).toBe(sha256Hex(issued.token));
    expect(row.tokenHash).not.toContain(issued.token);
  });

  it('expires after the configured lifetime', async () => {
    const user = await insertUser(dataSource);
    const now = new Date();
    const issued = await service.issue(user.id, now);

    expect(issued.expiresAt.getTime() - now.getTime()).toBe(3_600_000);
    expect(await service.resolve(issued.token, new Date(now.getTime() + 3_599_000))).not.toBeNull();
    expect(await service.resolve(issued.token, new Date(now.getTime() + 3_601_000))).toBeNull();
  });

  it.each(['', 'unknown-token', 'x'.repeat(10_000)])('resolves nothing for %j', async (token) => {
    expect(await service.resolve(token)).toBeNull();
  });

  it('revokes by id and by token', async () => {
    const user = await insertUser(dataSource);
    const byId = await service.issue(user.id);
    const byToken = await service.issue(user.id);

    await service.revoke(byId.id);
    await service.revokeToken(byToken.token);

    expect(await service.resolve(byId.token)).toBeNull();
    expect(await service.resolve(byToken.token)).toBeNull();
  });

  it('touches lastUsedAt at most once per minute', async () => {
    const user = await insertUser(dataSource);
    const start = new Date();
    const issued = await service.issue(user.id, start);
    const repository = dataSource.getRepository(Session);

    await service.resolve(issued.token, new Date(start.getTime() + 30_000));
    expect((await repository.findOneByOrFail({ id: issued.id })).lastUsedAt.getTime()).toBe(
      start.getTime()
    );

    const later = new Date(start.getTime() + 120_000);
    await service.resolve(issued.token, later);
    expect((await repository.findOneByOrFail({ id: issued.id })).lastUsedAt.getTime()).toBe(
      later.getTime()
    );
  });

  it("purges only the user's expired sessions", async () => {
    const user = await insertUser(dataSource);
    const other = await insertUser(dataSource);
    const past = new Date(Date.now() - 7_200_000);
    await service.issue(user.id, past);
    await service.issue(other.id, past);
    const alive = await service.issue(user.id);

    await service.purgeExpired(user.id);

    const remaining = await dataSource.getRepository(Session).find();
    expect(remaining.map((row) => row.userId).sort()).toEqual([user.id, other.id].sort());
    expect(await service.resolve(alive.token)).not.toBeNull();
  });
});

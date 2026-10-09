import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { ApiKey } from './api-key.entity.js';
import { ApiKeyService } from './api-key.service.js';
import { sha256Hex } from './tokens.js';

describe('ApiKeyService (database)', () => {
  let dataSource: DataSource;
  let service: ApiKeyService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new ApiKeyService(dataSource.getRepository(ApiKey));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetAuthTables(dataSource);
  });

  it('creates a key that is shown once and stored only as a hash', async () => {
    const user = await insertUser(dataSource);

    const { apiKey, key } = await service.create(user.id, 'ci');

    expect(key).toMatch(/^sk-[0-9a-f]{64}$/);
    expect(apiKey.prefix).toBe(key.slice(0, 8));
    const row = await dataSource.getRepository(ApiKey).findOneByOrFail({ id: apiKey.id });
    expect(row.keyHash).toBe(sha256Hex(key));
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it('resolves a valid key with its user', async () => {
    const user = await insertUser(dataSource);
    const { key } = await service.create(user.id, 'ci');

    const resolved = await service.resolve(key);

    expect(resolved?.user.id).toBe(user.id);
  });

  it.each(['', 'sk-unknown', `sk-${'0'.repeat(64)}`])('resolves nothing for %j', async (key) => {
    expect(await service.resolve(key)).toBeNull();
  });

  it('refuses revoked and expired keys', async () => {
    const user = await insertUser(dataSource);
    const revoked = await service.create(user.id, 'revoked');
    const expired = await service.create(user.id, 'expired', new Date(Date.now() - 1000));
    const future = await service.create(user.id, 'future', new Date(Date.now() + 3_600_000));
    await service.revoke(user.id, revoked.apiKey.id);

    expect(await service.resolve(revoked.key)).toBeNull();
    expect(await service.resolve(expired.key)).toBeNull();
    expect(await service.resolve(future.key)).not.toBeNull();
  });

  it("lists only the caller's own active keys", async () => {
    const ada = await insertUser(dataSource);
    const bob = await insertUser(dataSource);
    const adas = await service.create(ada.id, 'ada key');
    await service.create(bob.id, 'bob key');
    const gone = await service.create(ada.id, 'gone');
    await service.revoke(ada.id, gone.apiKey.id);

    const listed = await service.list(ada.id);

    expect(listed.map((row) => row.id)).toEqual([adas.apiKey.id]);
  });

  it("cannot revoke somebody else's key (the owner check is part of the SQL)", async () => {
    const ada = await insertUser(dataSource);
    const bob = await insertUser(dataSource);
    const { apiKey, key } = await service.create(ada.id, 'ada key');

    const revoked = await service.revoke(bob.id, apiKey.id);

    expect(revoked).toBe(false);
    expect(await service.resolve(key)).not.toBeNull();
  });

  it('reports false when revoking twice', async () => {
    const user = await insertUser(dataSource);
    const { apiKey } = await service.create(user.id, 'ci');

    expect(await service.revoke(user.id, apiKey.id)).toBe(true);
    expect(await service.revoke(user.id, apiKey.id)).toBe(false);
  });

  it('touches lastUsedAt at most once per minute', async () => {
    const user = await insertUser(dataSource);
    const { apiKey, key } = await service.create(user.id, 'ci');
    const repository = dataSource.getRepository(ApiKey);
    const start = new Date();

    await service.resolve(key, start);
    await service.resolve(key, new Date(start.getTime() + 30_000));
    expect((await repository.findOneByOrFail({ id: apiKey.id })).lastUsedAt?.getTime()).toBe(
      start.getTime()
    );

    const later = new Date(start.getTime() + 120_000);
    await service.resolve(key, later);
    expect((await repository.findOneByOrFail({ id: apiKey.id })).lastUsedAt?.getTime()).toBe(
      later.getTime()
    );
  });
});

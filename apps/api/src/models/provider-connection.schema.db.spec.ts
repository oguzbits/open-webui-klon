import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { resetProviderTables } from '../testing/db-fixtures.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { PROVIDER_TYPE } from './provider-type.js';

describe('provider_connection schema (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetProviderTables(dataSource);
  });

  function insert(overrides: Partial<ProviderConnection> = {}) {
    return dataSource.getRepository(ProviderConnection).insert({
      name: 'Lokales Ollama',
      type: PROVIDER_TYPE.OLLAMA,
      baseUrl: 'http://ollama:11434',
      ...overrides,
    });
  }

  it('stores a connection with defaults: enabled, no key, nothing hidden', async () => {
    await insert();

    const row = await dataSource
      .getRepository(ProviderConnection)
      .findOneByOrFail({ name: 'Lokales Ollama' });
    expect(row.enabled).toBe(true);
    expect(row.apiKeyCiphertext).toBeNull();
    expect(row.hiddenModelIds).toEqual([]);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('keeps an id chosen by the service', async () => {
    const id = randomUUID();

    await insert({ id });

    expect(await dataSource.getRepository(ProviderConnection).existsBy({ id })).toBe(true);
  });

  it('stores raw model ids that contain colons and slashes', async () => {
    await insert({ hiddenModelIds: ['llama3:8b', 'hf.co/acme/model:Q4_K_M'] });

    const row = await dataSource
      .getRepository(ProviderConnection)
      .findOneByOrFail({ name: 'Lokales Ollama' });
    expect(row.hiddenModelIds).toEqual(['llama3:8b', 'hf.co/acme/model:Q4_K_M']);
  });

  it('refuses a second connection with the same name', async () => {
    await insert();

    await expect(insert({ baseUrl: 'http://other:11434' })).rejects.toThrow(
      /provider_connection_name_idx|duplicate key/
    );
  });

  it('refuses an unknown type', async () => {
    await expect(
      dataSource.query(
        "INSERT INTO provider_connection (name, type, base_url) VALUES ('x', 'anthropic', 'http://x')"
      )
    ).rejects.toThrow(/provider_connection_type_check/);
  });
});

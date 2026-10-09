import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditLog } from '../database/audit/audit-log.entity.js';
import { AuditService } from '../database/audit/audit.service.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { parseAllowedHost } from '../http/safe-fetch/address-policy.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  ProviderFetchService,
} from '../http/safe-fetch/provider-fetch.service.js';
import { resetProviderTables } from '../testing/db-fixtures.js';
import { configOf, TEST_KEY_RING } from '../testing/provider-fixtures.js';
import { ModelListCache } from './model-list-cache.js';
import { ProviderConnection } from './provider-connection.entity.js';
import {
  CONNECTIONS_LOCK_KEY,
  ProviderConnectionsService,
} from './provider-connections.service.js';
import { PROVIDER_TYPE } from './provider-type.js';
import { SECRET_BOX_ERROR, SecretBox, SecretBoxError } from './secret-box.js';

const ACTOR = randomUUID();
const SECRET = 'sk-very-secret-value';

/** Names the tests use: allowed.test -> a private address on the list, blocked.test -> metadata. */
const ADDRESSES: Record<string, string> = {
  'allowed.test': '10.0.0.5',
  'blocked.test': '169.254.169.254',
  'public.test': '93.184.216.34',
};

describe('ProviderConnectionsService (database)', () => {
  let dataSource: DataSource;
  let service: ProviderConnectionsService;
  let secretBox: SecretBox;
  let cache: ModelListCache;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    secretBox = new SecretBox(configOf({ PROVIDER_KEY_ENCRYPTION_KEYS: TEST_KEY_RING }));
    cache = new ModelListCache(configOf({ MODEL_LIST_CACHE_TTL_MS: 60_000 }));
    const providerFetch = new ProviderFetchService({
      ...PROVIDER_FETCH_DEFAULTS,
      timeoutMs: 1000,
      allowedHosts: [parseAllowedHost('allowed.test')],
      lookup: (hostname) => {
        const address = ADDRESSES[hostname];
        return address === undefined
          ? Promise.reject(new Error('ENOTFOUND'))
          : Promise.resolve([{ address, family: 4 }]);
      },
    });
    service = new ProviderConnectionsService(
      dataSource,
      secretBox,
      providerFetch,
      cache,
      new AuditService(dataSource.getRepository(AuditLog))
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetProviderTables(dataSource);
  });

  const input = (overrides: Partial<Parameters<ProviderConnectionsService['create']>[1]> = {}) => ({
    name: 'Lokales Ollama',
    type: PROVIDER_TYPE.OLLAMA,
    baseUrl: 'http://allowed.test:11434',
    ...overrides,
  });

  async function auditOf(targetId: string): Promise<AuditLog[]> {
    return dataSource
      .getRepository(AuditLog)
      .find({ where: { targetId }, order: { occurredAt: 'ASC' } });
  }

  async function stored(id: string): Promise<ProviderConnection> {
    return dataSource.getRepository(ProviderConnection).findOneByOrFail({ id });
  }

  describe('create', () => {
    it('stores the normalized URL, encrypts the key and audits without the key', async () => {
      const created = await service.create(
        ACTOR,
        input({ baseUrl: 'HTTP://Allowed.test:11434//', apiKey: SECRET })
      );

      const row = await stored(created.id);
      expect(row.baseUrl).toBe('http://allowed.test:11434');
      expect(row.enabled).toBe(true);
      expect(row.apiKeyCiphertext).toMatch(/^v1\./);
      expect(row.apiKeyCiphertext).not.toContain(SECRET);
      expect(secretBox.decrypt(row.apiKeyCiphertext ?? '', row.id)).toBe(SECRET);

      const [entry] = await auditOf(created.id);
      expect(entry).toMatchObject({
        actorId: ACTOR,
        action: AUDIT_ACTION.PROVIDER_CONNECTION_CREATED,
        targetType: 'provider_connection',
        metadata: { name: 'Lokales Ollama', type: PROVIDER_TYPE.OLLAMA },
      });
      expect(JSON.stringify(entry)).not.toContain(SECRET);
      expect(JSON.stringify(entry)).not.toContain('v1.');
    });

    it('stores no ciphertext when there is no key', async () => {
      const created = await service.create(ACTOR, input());

      expect((await stored(created.id)).apiKeyCiphertext).toBeNull();
    });

    it.each([
      'http://user:pass@allowed.test',
      'http://allowed.test/v1?token=abc',
      'ftp://allowed.test',
      'allowed.test:11434',
      'not a url',
      '',
    ])('refuses the URL %j with 422 and stores nothing', async (baseUrl) => {
      await expect(service.create(ACTOR, input({ baseUrl, apiKey: SECRET }))).rejects.toThrow(
        UnprocessableEntityException
      );

      expect(await dataSource.getRepository(ProviderConnection).count()).toBe(0);
    });

    it.each(['http://blocked.test', 'http://169.254.169.254', 'http://10.0.0.9'])(
      'refuses the blocked host %s with 422',
      async (baseUrl) => {
        await expect(service.create(ACTOR, input({ baseUrl }))).rejects.toThrow(
          UnprocessableEntityException
        );

        expect(await dataSource.getRepository(ProviderConnection).count()).toBe(0);
      }
    );

    it('accepts a public host that is on no list', async () => {
      const created = await service.create(ACTOR, input({ baseUrl: 'http://public.test/' }));

      expect((await stored(created.id)).baseUrl).toBe('http://public.test');
    });

    it('saves a name that does not resolve yet (a container that is still starting)', async () => {
      const created = await service.create(ACTOR, input({ baseUrl: 'http://not-yet.test:11434' }));

      expect((await stored(created.id)).baseUrl).toBe('http://not-yet.test:11434');
    });

    it('answers 409 for a name that is taken', async () => {
      await service.create(ACTOR, input());

      await expect(service.create(ACTOR, input({ baseUrl: 'http://public.test' }))).rejects.toThrow(
        ConflictException
      );
    });

    it('lets exactly one of twenty parallel creations with the same name win', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => service.create(ACTOR, input()))
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(rejected).toHaveLength(19);
      for (const result of rejected) expect(result.reason).toBeInstanceOf(ConflictException);
      expect(await dataSource.getRepository(ProviderConnection).count()).toBe(1);
    });

    it('waits for the connections lock before it creates anything', async () => {
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query('SELECT pg_advisory_xact_lock($1)', [CONNECTIONS_LOCK_KEY]);
      let settled = false;
      const creation = service.create(ACTOR, input()).finally(() => {
        settled = true;
      });

      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);
      } finally {
        await holder.commitTransaction();
        await holder.release();
      }

      await creation;
      expect(await dataSource.getRepository(ProviderConnection).count()).toBe(1);
    });
  });

  describe('update', () => {
    it('leaves the key alone when the field is missing, replaces it with a string, removes it with null', async () => {
      const created = await service.create(ACTOR, input({ apiKey: SECRET }));
      const before = (await stored(created.id)).apiKeyCiphertext;

      await service.update(ACTOR, created.id, { name: 'Umbenannt' });
      expect((await stored(created.id)).apiKeyCiphertext).toBe(before);

      await service.update(ACTOR, created.id, { apiKey: 'sk-new' });
      const replaced = (await stored(created.id)).apiKeyCiphertext;
      expect(replaced).not.toBe(before);
      expect(secretBox.decrypt(replaced ?? '', created.id)).toBe('sk-new');

      await service.update(ACTOR, created.id, { apiKey: null });
      expect((await stored(created.id)).apiKeyCiphertext).toBeNull();
    });

    it('changes the fields it is given and normalizes the URL', async () => {
      const created = await service.create(ACTOR, input());

      const updated = await service.update(ACTOR, created.id, {
        baseUrl: 'https://public.test/v1/',
        enabled: false,
        hiddenModelIds: ['llama3:8b', 'llama3:8b', 'hf.co/acme/m:Q4'],
      });

      expect(updated).toMatchObject({
        baseUrl: 'https://public.test/v1',
        enabled: false,
        hiddenModelIds: ['llama3:8b', 'hf.co/acme/m:Q4'],
      });
      expect(await stored(created.id)).toMatchObject({ enabled: false, name: 'Lokales Ollama' });
    });

    it('checks the host of a new URL', async () => {
      const created = await service.create(ACTOR, input());

      await expect(
        service.update(ACTOR, created.id, { baseUrl: 'http://blocked.test' })
      ).rejects.toThrow(UnprocessableEntityException);
      await expect(
        service.update(ACTOR, created.id, { baseUrl: 'http://u:p@public.test' })
      ).rejects.toThrow(UnprocessableEntityException);
      expect((await stored(created.id)).baseUrl).toBe('http://allowed.test:11434');
    });

    it('answers 409 when renaming to a taken name, but may keep its own name', async () => {
      await service.create(ACTOR, input({ name: 'A' }));
      const b = await service.create(ACTOR, input({ name: 'B' }));

      await expect(service.update(ACTOR, b.id, { name: 'A' })).rejects.toThrow(ConflictException);
      await expect(service.update(ACTOR, b.id, { name: 'B' })).resolves.toBeDefined();
    });

    it('answers 404 for an unknown connection', async () => {
      await expect(service.update(ACTOR, randomUUID(), { enabled: false })).rejects.toThrow(
        NotFoundException
      );
    });

    it('audits the names of the changed fields only, never values', async () => {
      const created = await service.create(ACTOR, input());

      await service.update(ACTOR, created.id, { apiKey: SECRET, enabled: false, name: 'Neu' });

      const updated = (await auditOf(created.id)).find(
        (entry) => entry.action === AUDIT_ACTION.PROVIDER_CONNECTION_UPDATED
      );
      expect(updated?.metadata).toEqual({ name: 'Neu', changed: ['name', 'enabled', 'apiKey'] });
      expect(JSON.stringify(updated)).not.toContain(SECRET);
    });

    it('writes no audit entry when nothing changed', async () => {
      const created = await service.create(ACTOR, input());

      await service.update(ACTOR, created.id, { name: 'Lokales Ollama', enabled: true });

      expect(await auditOf(created.id)).toHaveLength(1);
    });

    it('discards the cached model list of the connection', async () => {
      const created = await service.create(ACTOR, input());
      cache.set(created.id, [{ id: 'm', name: 'm' }], cache.ticket(created.id));
      expect(cache.get(created.id)).toBeDefined();

      await service.update(ACTOR, created.id, { enabled: false });

      expect(cache.get(created.id)).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('deletes the connection, discards its cache and audits it', async () => {
      const created = await service.create(ACTOR, input({ apiKey: SECRET }));
      cache.set(created.id, [{ id: 'm', name: 'm' }], cache.ticket(created.id));

      await service.remove(ACTOR, created.id);

      expect(await dataSource.getRepository(ProviderConnection).existsBy({ id: created.id })).toBe(
        false
      );
      expect(cache.get(created.id)).toBeUndefined();
      const entries = await auditOf(created.id);
      expect(entries.at(-1)).toMatchObject({
        action: AUDIT_ACTION.PROVIDER_CONNECTION_DELETED,
        metadata: { name: 'Lokales Ollama' },
      });
    });

    it('answers 404 for an unknown connection', async () => {
      await expect(service.remove(ACTOR, randomUUID())).rejects.toThrow(NotFoundException);
    });
  });

  describe('reading', () => {
    it('lists by name, finds only enabled connections as enabled', async () => {
      const b = await service.create(ACTOR, input({ name: 'B' }));
      const a = await service.create(ACTOR, input({ name: 'A', enabled: false }));

      expect((await service.list()).map((item) => item.name)).toEqual(['A', 'B']);
      expect((await service.listEnabled()).map((item) => item.name)).toEqual(['B']);
      expect(await service.findEnabled(a.id)).toBeNull();
      expect((await service.findEnabled(b.id))?.id).toBe(b.id);
      await expect(service.get(randomUUID())).rejects.toThrow(NotFoundException);
    });

    it('targetOf decrypts the key for the call and gives undefined without one', async () => {
      const withKey = await service.create(ACTOR, input({ name: 'K', apiKey: SECRET }));
      const without = await service.create(ACTOR, input({ name: 'N' }));

      expect(service.targetOf(await stored(withKey.id))).toEqual({
        connectionId: withKey.id,
        baseUrl: 'http://allowed.test:11434',
        apiKey: SECRET,
      });
      expect(service.targetOf(await stored(without.id)).apiKey).toBeUndefined();
    });

    it('does not decrypt a ciphertext that was copied into another row', async () => {
      const a = await service.create(ACTOR, input({ name: 'A', apiKey: SECRET }));
      const b = await service.create(ACTOR, input({ name: 'B' }));
      const copied = Object.assign(await stored(b.id), {
        apiKeyCiphertext: (await stored(a.id)).apiKeyCiphertext,
      });

      let code: string | undefined;
      try {
        service.targetOf(copied);
      } catch (error) {
        code = error instanceof SecretBoxError ? error.code : undefined;
      }

      expect(code).toBe(SECRET_BOX_ERROR.TAMPERED);
    });
  });
});

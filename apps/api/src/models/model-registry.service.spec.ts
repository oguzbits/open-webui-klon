import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { configOf, silentLogger } from '../testing/provider-fixtures.js';
import { formatModelId } from './model-id.js';
import { ModelListCache } from './model-list-cache.js';
import { ModelRegistryService } from './model-registry.service.js';
import {
  PROVIDER_ADAPTERS,
  type ProviderAdapter,
  type ProviderTarget,
  type RawModel,
} from './provider-adapter.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return Object.assign(new ProviderConnection(), {
    id: randomUUID(),
    name: 'Lokales Ollama',
    type: PROVIDER_TYPE.OLLAMA,
    baseUrl: 'http://ollama:11434',
    apiKeyCiphertext: null,
    enabled: true,
    hiddenModelIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function raw(...ids: string[]): RawModel[] {
  return ids.map((id) => ({ id, name: id }));
}

class FakeAdapter implements ProviderAdapter {
  listCalls = 0;
  readonly built: { target: ProviderTarget; rawModelId: string }[] = [];
  readonly answers = new Map<string, RawModel[] | Error>();
  gate: Promise<void> | undefined;
  readonly model: LanguageModel = new MockLanguageModelV4();

  constructor(readonly type: ProviderType) {}

  async listModels(target: ProviderTarget): Promise<RawModel[]> {
    this.listCalls += 1;
    await this.gate;
    const answer = this.answers.get(target.connectionId) ?? [];
    if (answer instanceof Error) throw answer;
    return answer;
  }

  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel {
    this.built.push({ target, rawModelId });
    return this.model;
  }
}

async function setup(ttlMs = 30_000) {
  const state = { connections: [] as ProviderConnection[] };
  const ollama = new FakeAdapter(PROVIDER_TYPE.OLLAMA);
  const openai = new FakeAdapter(PROVIDER_TYPE.OPENAI_COMPATIBLE);
  const cache = new ModelListCache(configOf({ MODEL_LIST_CACHE_TTL_MS: ttlMs }));
  const connections = {
    listEnabled: () => Promise.resolve(state.connections.filter((item) => item.enabled)),
    get: (id: string) => {
      const found = state.connections.find((item) => item.id === id);
      return found === undefined
        ? Promise.reject(new NotFoundException('Connection not found'))
        : Promise.resolve(found);
    },
    findEnabled: (id: string) =>
      Promise.resolve(state.connections.find((item) => item.id === id && item.enabled) ?? null),
    targetOf: (item: ProviderConnection): ProviderTarget => ({
      connectionId: item.id,
      baseUrl: item.baseUrl,
      apiKey: undefined,
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ModelRegistryService,
      { provide: ProviderConnectionsService, useValue: connections },
      { provide: PROVIDER_ADAPTERS, useValue: [ollama, openai] },
      { provide: ModelListCache, useValue: cache },
      { provide: PinoLogger, useValue: silentLogger() },
    ],
  }).compile();
  return { registry: moduleRef.get(ModelRegistryService), state, ollama, openai, cache };
}

describe('ModelRegistryService.list', () => {
  it('merges the models of all active connections, sorted, with their provider', async () => {
    const { registry, state, ollama, openai } = await setup();
    const local = connection({ name: 'Lokal' });
    const cloud = connection({ name: 'Cloud', type: PROVIDER_TYPE.OPENAI_COMPATIBLE });
    state.connections.push(local, cloud);
    ollama.answers.set(local.id, raw('mistral:7b', 'llama3:8b'));
    openai.answers.set(cloud.id, raw('gpt-4o'));

    const result = await registry.list();

    expect(result.unavailableConnections).toEqual([]);
    expect(result.models).toEqual([
      {
        id: formatModelId(cloud.id, 'gpt-4o'),
        name: 'gpt-4o',
        connectionId: cloud.id,
        providerName: 'Cloud',
        providerType: PROVIDER_TYPE.OPENAI_COMPATIBLE,
      },
      {
        id: formatModelId(local.id, 'llama3:8b'),
        name: 'llama3:8b',
        connectionId: local.id,
        providerName: 'Lokal',
        providerType: PROVIDER_TYPE.OLLAMA,
      },
      {
        id: formatModelId(local.id, 'mistral:7b'),
        name: 'mistral:7b',
        connectionId: local.id,
        providerName: 'Lokal',
        providerType: PROVIDER_TYPE.OLLAMA,
      },
    ]);
  });

  it('leaves out hidden models, duplicates and ids that cannot be addressed', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ hiddenModelIds: ['mistral:7b'] });
    state.connections.push(local);
    ollama.answers.set(
      local.id,
      raw('llama3:8b', 'llama3:8b', 'mistral:7b', 'bad\nid', 'x'.repeat(600), 'hf.co/acme/m:Q4')
    );

    const names = (await registry.list()).models.map((model) => model.name);

    expect(names).toEqual(['hf.co/acme/m:Q4', 'llama3:8b']);
  });

  it('reports a failing connection with its reason and still lists the others', async () => {
    const { registry, state, ollama, openai } = await setup();
    const down = connection({ name: 'Down' });
    const fine = connection({ name: 'Fine', type: PROVIDER_TYPE.OPENAI_COMPATIBLE });
    state.connections.push(down, fine);
    ollama.answers.set(down.id, new ProviderError(PROVIDER_ERROR.TIMEOUT, 'slow'));
    openai.answers.set(fine.id, raw('gpt-4o'));

    const result = await registry.list();

    expect(result.unavailableConnections).toEqual([
      { id: down.id, name: 'Down', reason: PROVIDER_ERROR.TIMEOUT },
    ]);
    expect(result.models.map((model) => model.name)).toEqual(['gpt-4o']);
  });

  it('does not hide a programming error behind "unavailable"', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new TypeError('boom'));

    await expect(registry.list()).rejects.toThrow(TypeError);
  });

  it('asks all connections at the same time', async () => {
    const { registry, state, ollama } = await setup();
    state.connections.push(connection({ name: 'A' }), connection({ name: 'B' }));
    let release: () => void = () => undefined;
    ollama.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = registry.list();
    await expect.poll(() => ollama.listCalls).toBe(2);
    release();

    expect((await pending).models).toEqual([]);
  });
});

describe('ModelRegistryService: cache', () => {
  it('answers the second list from memory', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b'));

    await registry.list();
    await registry.list();

    expect(ollama.listCalls).toBe(1);
  });

  it('asks the provider again after an invalidation', async () => {
    const { registry, state, ollama, cache } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b'));
    await registry.list();

    cache.invalidate(local.id);
    await registry.list();

    expect(ollama.listCalls).toBe(2);
  });

  it('does not cache a failure', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'down'));
    await registry.list();

    ollama.answers.set(local.id, raw('llama3:8b'));
    const result = await registry.list();

    expect(result.models).toHaveLength(1);
    expect(ollama.listCalls).toBe(2);
  });

  it('shows a changed hide list at once, because the stored list is filtered on every read', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b', 'mistral:7b'));
    await registry.list();

    local.hiddenModelIds = ['llama3:8b'];

    expect((await registry.list()).models.map((model) => model.name)).toEqual(['mistral:7b']);
    expect(ollama.listCalls).toBe(1);
  });
});

describe('ModelRegistryService: admin views', () => {
  it('lists all models of a connection with the hidden flag, also for a disabled connection', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ enabled: false, hiddenModelIds: ['mistral:7b'] });
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b', 'mistral:7b'));

    const result = await registry.listForConnection(local.id);

    expect(result.models).toEqual([
      { rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false },
      { rawModelId: 'mistral:7b', name: 'mistral:7b', hidden: true },
    ]);
  });

  it('lets the reason of a failed list through (the controller answers 502)', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new ProviderError(PROVIDER_ERROR.UNAUTHORIZED, 'no'));

    await expect(registry.listForConnection(local.id)).rejects.toMatchObject({
      reason: PROVIDER_ERROR.UNAUTHORIZED,
    });
  });

  it('answers 404 for an unknown connection', async () => {
    const { registry } = await setup();

    await expect(registry.listForConnection(randomUUID())).rejects.toThrow(NotFoundException);
    await expect(registry.test(randomUUID())).rejects.toThrow(NotFoundException);
  });

  it('test() asks the provider even when a list is cached, and counts all models', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ hiddenModelIds: ['mistral:7b'] });
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b', 'mistral:7b'));
    await registry.listForConnection(local.id);

    const result = await registry.test(local.id);

    expect(result).toEqual({ ok: true, modelCount: 2 });
    expect(ollama.listCalls).toBe(2);
  });

  it('test() throws the reason of a failure', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new ProviderError(PROVIDER_ERROR.BLOCKED_HOST, 'no'));

    await expect(registry.test(local.id)).rejects.toMatchObject({
      reason: PROVIDER_ERROR.BLOCKED_HOST,
    });
  });
});

describe('ModelRegistryService.resolve', () => {
  it('returns the adapter model for the raw id, split at the first colon', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ name: 'Lokal' });
    state.connections.push(local);

    const resolved = await registry.resolve(formatModelId(local.id, 'llama3:8b'));

    expect(resolved.model).toBe(ollama.model);
    expect(resolved.rawModelId).toBe('llama3:8b');
    expect(resolved.connection).toEqual({
      id: local.id,
      name: 'Lokal',
      type: PROVIDER_TYPE.OLLAMA,
    });
    expect(ollama.built).toEqual([
      {
        target: { connectionId: local.id, baseUrl: local.baseUrl, apiKey: undefined },
        rawModelId: 'llama3:8b',
      },
    ]);
  });

  it('picks the adapter of the connection type and needs no call to the provider', async () => {
    const { registry, state, ollama, openai } = await setup();
    const cloud = connection({ type: PROVIDER_TYPE.OPENAI_COMPATIBLE });
    state.connections.push(cloud);

    await registry.resolve(formatModelId(cloud.id, 'gpt-4o'));

    expect(openai.built).toHaveLength(1);
    expect(ollama.built).toHaveLength(0);
    expect(openai.listCalls + ollama.listCalls).toBe(0);
  });

  it('refuses a hidden model, a disabled or unknown connection with 404', async () => {
    const { registry, state } = await setup();
    const hidden = connection({ hiddenModelIds: ['mistral:7b'] });
    const off = connection({ enabled: false });
    state.connections.push(hidden, off);

    for (const id of [
      formatModelId(hidden.id, 'mistral:7b'),
      formatModelId(off.id, 'llama3:8b'),
      formatModelId(randomUUID(), 'llama3:8b'),
    ]) {
      await expect(registry.resolve(id)).rejects.toThrow(NotFoundException);
    }
  });

  it.each([
    ['empty', ''],
    ['no colon', randomUUID()],
    ['nothing after the colon', `${randomUUID()}:`],
    ['no connection', ':llama3'],
    ['not a uuid', 'prod:llama3'],
    ['control character', `${randomUUID()}:a\nb`],
  ])('answers 404, never 500, for a broken id (%s)', async (_name, id) => {
    const { registry } = await setup();

    await expect(registry.resolve(id)).rejects.toThrow(NotFoundException);
  });
});

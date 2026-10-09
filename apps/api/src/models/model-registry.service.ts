import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LanguageModel } from 'ai';
import { PinoLogger } from 'nestjs-pino';

import { ProviderError, type ProviderErrorReason } from '../http/safe-fetch/provider-error.js';
import { formatModelId, parseModelId } from './model-id.js';
import { ModelListCache } from './model-list-cache.js';
import type {
  AdminModelListDto,
  ConnectionTestDto,
  ModelDto,
  ModelListDto,
  UnavailableConnectionDto,
} from './models.dto.js';
import { PROVIDER_ADAPTERS, type ProviderAdapter, type RawModel } from './provider-adapter.js';
import type { ProviderConnection } from './provider-connection.entity.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import type { ProviderType } from './provider-type.js';

export interface ResolvedModel {
  model: LanguageModel;
  connection: { id: string; name: string; type: ProviderType };
  rawModelId: string;
}

type Attempt =
  | { connection: ProviderConnection; models: RawModel[] }
  | { connection: ProviderConnection; reason: ProviderErrorReason };

/** Unusable ids (control characters, too long) and duplicates are dropped; the rest can be addressed again. */
function addressable(connectionId: string, models: RawModel[]): RawModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    if (parseModelId(formatModelId(connectionId, model.id)) === undefined) return false;
    seen.add(model.id);
    return true;
  });
}

@Injectable()
export class ModelRegistryService {
  constructor(
    private readonly connections: ProviderConnectionsService,
    @Inject(PROVIDER_ADAPTERS) private readonly adapters: readonly ProviderAdapter[],
    private readonly cache: ModelListCache,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ModelRegistryService.name);
  }

  /**
   * All models of the active connections, without hidden ones. A connection that fails is named with its reason
   * in `unavailableConnections`; the others are not held up. Anything that is not a ProviderError (a bug, an
   * unreadable key) is thrown, not turned into "unavailable".
   */
  async list(): Promise<ModelListDto> {
    const enabled = await this.connections.listEnabled();
    const attempts = await Promise.all(enabled.map((connection) => this.attempt(connection)));

    const models: ModelDto[] = [];
    const unavailableConnections: UnavailableConnectionDto[] = [];
    for (const attempt of attempts) {
      const { connection } = attempt;
      if ('reason' in attempt) {
        unavailableConnections.push({
          id: connection.id,
          name: connection.name,
          reason: attempt.reason,
        });
        continue;
      }
      for (const model of attempt.models) {
        if (connection.hiddenModelIds.includes(model.id)) continue;
        models.push({
          id: formatModelId(connection.id, model.id),
          name: model.name,
          connectionId: connection.id,
          providerName: connection.name,
          providerType: connection.type,
        });
      }
    }
    models.sort(
      (a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name)
    );
    return { models, unavailableConnections };
  }

  /** Admin: every model of one connection, hidden ones flagged. Works for a disabled connection, too. */
  async listForConnection(connectionId: string): Promise<AdminModelListDto> {
    const connection = await this.connections.get(connectionId);
    const models = await this.fetchModels(connection, false);
    return {
      models: models.map((model) => ({
        rawModelId: model.id,
        name: model.name,
        hidden: connection.hiddenModelIds.includes(model.id),
      })),
    };
  }

  /** Admin: asks the provider now (never from the cache); a failure is thrown with its reason. */
  async test(connectionId: string): Promise<ConnectionTestDto> {
    const connection = await this.connections.get(connectionId);
    const models = await this.fetchModels(connection, true);
    return { ok: true, modelCount: models.length };
  }

  /**
   * The AI SDK model for an id from `list()`. Checks only what the registry owns: the connection is active and
   * the model is not hidden. It makes no call to the provider; a model the provider does not know fails when it
   * is used. Every refusal is the same 404 so the answer does not tell which part was wrong.
   */
  async resolve(modelId: string): Promise<ResolvedModel> {
    const parsed = parseModelId(modelId);
    if (parsed === undefined) throw new NotFoundException('Model not found');
    const connection = await this.connections.findEnabled(parsed.connectionId);
    if (connection === null || connection.hiddenModelIds.includes(parsed.rawModelId)) {
      throw new NotFoundException('Model not found');
    }
    const model = this.adapterFor(connection.type).languageModel(
      this.connections.targetOf(connection),
      parsed.rawModelId
    );
    return {
      model,
      connection: { id: connection.id, name: connection.name, type: connection.type },
      rawModelId: parsed.rawModelId,
    };
  }

  private async attempt(connection: ProviderConnection): Promise<Attempt> {
    try {
      return { connection, models: await this.fetchModels(connection, false) };
    } catch (error) {
      if (error instanceof ProviderError) return { connection, reason: error.reason };
      throw error;
    }
  }

  private async fetchModels(connection: ProviderConnection, fresh: boolean): Promise<RawModel[]> {
    if (!fresh) {
      const cached = this.cache.get(connection.id);
      if (cached !== undefined) return cached;
    }
    const ticket = this.cache.ticket(connection.id);
    const adapter = this.adapterFor(connection.type);
    const target = this.connections.targetOf(connection);
    const started = Date.now();
    try {
      const models = addressable(connection.id, await adapter.listModels(target));
      this.cache.set(connection.id, models, ticket);
      this.logger.info(
        {
          connectionId: connection.id,
          type: connection.type,
          models: models.length,
          durationMs: Date.now() - started,
        },
        'Model list fetched'
      );
      return models;
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.warn(
          {
            connectionId: connection.id,
            type: connection.type,
            reason: error.reason,
            durationMs: Date.now() - started,
          },
          'Model list failed'
        );
      }
      throw error;
    }
  }

  private adapterFor(type: ProviderType): ProviderAdapter {
    const adapter = this.adapters.find((candidate) => candidate.type === type);
    if (adapter === undefined) throw new Error(`No adapter for the provider type "${type}"`);
    return adapter;
  }
}

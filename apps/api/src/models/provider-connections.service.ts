import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditService } from '../database/audit/audit.service.js';
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ProviderFetchService } from '../http/safe-fetch/provider-fetch.service.js';
import { InvalidBaseUrlError, normalizeBaseUrl } from './base-url.js';
import { ModelListCache } from './model-list-cache.js';
import type { ProviderTarget } from './provider-adapter.js';
import { ProviderConnection } from './provider-connection.entity.js';
import type { ProviderType } from './provider-type.js';
import { SecretBox } from './secret-box.js';

/** One advisory lock serializes writes that depend on the names of the other connections. */
export const CONNECTIONS_LOCK_KEY = 7102;

export interface NewConnection {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

/** `apiKey`: missing = unchanged, `null` = remove, a string = replace. The type cannot be changed. */
export interface ConnectionPatch {
  name?: string;
  baseUrl?: string;
  apiKey?: string | null;
  enabled?: boolean;
  hiddenModelIds?: string[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

@Injectable()
export class ProviderConnectionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly secretBox: SecretBox,
    private readonly providerFetch: ProviderFetchService,
    private readonly cache: ModelListCache,
    private readonly audit: AuditService
  ) {}

  list(): Promise<ProviderConnection[]> {
    return this.dataSource.getRepository(ProviderConnection).find({ order: { name: 'ASC' } });
  }

  listEnabled(): Promise<ProviderConnection[]> {
    return this.dataSource
      .getRepository(ProviderConnection)
      .find({ where: { enabled: true }, order: { name: 'ASC' } });
  }

  async get(id: string): Promise<ProviderConnection> {
    const found = await this.dataSource.getRepository(ProviderConnection).findOneBy({ id });
    if (found === null) throw new NotFoundException('Connection not found');
    return found;
  }

  findEnabled(id: string): Promise<ProviderConnection | null> {
    return this.dataSource.getRepository(ProviderConnection).findOneBy({ id, enabled: true });
  }

  /** Decrypts the key. The result lives for one call and is never logged or returned. */
  targetOf(connection: ProviderConnection): ProviderTarget {
    return {
      connectionId: connection.id,
      baseUrl: connection.baseUrl,
      apiKey:
        connection.apiKeyCiphertext === null
          ? undefined
          : this.secretBox.decrypt(connection.apiKeyCiphertext, connection.id),
    };
  }

  async create(actorId: string, input: NewConnection): Promise<ProviderConnection> {
    // The host check resolves DNS: do it before the lock so a slow resolver does not block other admins.
    const baseUrl = await this.checkedBaseUrl(input.baseUrl);
    // The id is chosen here: it is part of the authenticated data of the encrypted key.
    const id = randomUUID();
    const created = await this.withLock(async (manager) => {
      await this.assertNameFree(manager, input.name);
      return manager.save(
        manager.create(ProviderConnection, {
          id,
          name: input.name,
          type: input.type,
          baseUrl,
          apiKeyCiphertext:
            input.apiKey === undefined ? null : this.secretBox.encrypt(input.apiKey, id),
          enabled: input.enabled ?? true,
          hiddenModelIds: [],
        })
      );
    });
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.PROVIDER_CONNECTION_CREATED,
      targetType: 'provider_connection',
      targetId: created.id,
      metadata: { name: created.name, type: created.type },
    });
    return created;
  }

  async update(actorId: string, id: string, patch: ConnectionPatch): Promise<ProviderConnection> {
    const baseUrl =
      patch.baseUrl === undefined ? undefined : await this.checkedBaseUrl(patch.baseUrl);
    const { saved, changed } = await this.withLock(async (manager) => {
      const found = await manager.findOneBy(ProviderConnection, { id });
      if (found === null) throw new NotFoundException('Connection not found');
      const changed: string[] = [];

      if (patch.name !== undefined && patch.name !== found.name) {
        await this.assertNameFree(manager, patch.name);
        found.name = patch.name;
        changed.push('name');
      }
      if (baseUrl !== undefined && baseUrl !== found.baseUrl) {
        found.baseUrl = baseUrl;
        changed.push('baseUrl');
      }
      if (patch.enabled !== undefined && patch.enabled !== found.enabled) {
        found.enabled = patch.enabled;
        changed.push('enabled');
      }
      if (patch.hiddenModelIds !== undefined) {
        const hidden = [...new Set(patch.hiddenModelIds)];
        if (!sameList(hidden, found.hiddenModelIds)) {
          found.hiddenModelIds = hidden;
          changed.push('hiddenModelIds');
        }
      }
      if (patch.apiKey !== undefined) {
        const next = patch.apiKey === null ? null : this.secretBox.encrypt(patch.apiKey, id);
        if (next !== found.apiKeyCiphertext) {
          found.apiKeyCiphertext = next;
          changed.push('apiKey');
        }
      }
      return { saved: changed.length > 0 ? await manager.save(found) : found, changed };
    });

    if (changed.length > 0) {
      this.cache.invalidate(id);
      await this.audit.record({
        actorId,
        action: AUDIT_ACTION.PROVIDER_CONNECTION_UPDATED,
        targetType: 'provider_connection',
        targetId: id,
        metadata: { name: saved.name, changed },
      });
    }
    return saved;
  }

  async remove(actorId: string, id: string): Promise<void> {
    const name = await this.withLock(async (manager) => {
      const found = await manager.findOneBy(ProviderConnection, { id });
      if (found === null) throw new NotFoundException('Connection not found');
      await manager.delete(ProviderConnection, { id });
      return found.name;
    });
    this.cache.invalidate(id);
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.PROVIDER_CONNECTION_DELETED,
      targetType: 'provider_connection',
      targetId: id,
      metadata: { name },
    });
  }

  /**
   * Normalizes the URL and refuses a host that may never be reached. A name that does not resolve yet is
   * saved: the container may still be starting, and every call checks the address again anyway.
   */
  private async checkedBaseUrl(raw: string): Promise<string> {
    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(raw);
    } catch (error) {
      if (error instanceof InvalidBaseUrlError)
        throw new UnprocessableEntityException(error.message);
      throw error;
    }
    try {
      await this.providerFetch.assertHostAllowed(baseUrl);
    } catch (error) {
      if (error instanceof ProviderError && error.reason === PROVIDER_ERROR.BLOCKED_HOST) {
        throw new UnprocessableEntityException('This host is not allowed for model providers');
      }
      if (!(error instanceof ProviderError && error.reason === PROVIDER_ERROR.UNREACHABLE)) {
        throw error;
      }
    }
    return baseUrl;
  }

  private withLock<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [CONNECTIONS_LOCK_KEY]);
      return work(manager);
    });
  }

  private async assertNameFree(manager: EntityManager, name: string): Promise<void> {
    if (await manager.existsBy(ProviderConnection, { name })) {
      throw new ConflictException('A connection with this name already exists');
    }
  }
}

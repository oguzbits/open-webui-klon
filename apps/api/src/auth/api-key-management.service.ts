import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditService } from '../database/audit/audit.service.js';
import type { ApiKey } from './api-key.entity.js';
import { type CreatedApiKey, ApiKeyService } from './api-key.service.js';

const DAY_MS = 86_400_000;

/** What a signed-in user may do with their own keys: switch, ownership and audit live here, not in the controller. */
@Injectable()
export class ApiKeyManagementService {
  private readonly enabled: boolean;

  constructor(
    private readonly keys: ApiKeyService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>
  ) {
    this.enabled = config.get('ENABLE_API_KEYS', { infer: true });
  }

  list(userId: string): Promise<ApiKey[]> {
    this.assertEnabled();
    return this.keys.list(userId);
  }

  async create(
    userId: string,
    input: { name: string; expiresInDays?: number }
  ): Promise<CreatedApiKey> {
    this.assertEnabled();
    const expiresAt =
      input.expiresInDays === undefined
        ? null
        : new Date(Date.now() + input.expiresInDays * DAY_MS);
    const created = await this.keys.create(userId, input.name, expiresAt);
    await this.audit.record({
      actorId: userId,
      action: AUDIT_ACTION.API_KEY_CREATED,
      targetType: 'api_key',
      targetId: created.apiKey.id,
    });
    return created;
  }

  async revoke(userId: string, id: string): Promise<void> {
    this.assertEnabled();
    // The owner check is part of the UPDATE: a foreign id looks exactly like an unknown one.
    if (!(await this.keys.revoke(userId, id))) throw new NotFoundException('API key not found');
    await this.audit.record({
      actorId: userId,
      action: AUDIT_ACTION.API_KEY_REVOKED,
      targetType: 'api_key',
      targetId: id,
    });
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }
}

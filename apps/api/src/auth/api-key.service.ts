import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import { ApiKey } from './api-key.entity.js';
import { generateApiKey, sha256Hex } from './tokens.js';

const TOUCH_INTERVAL_MS = 60_000;
const PREFIX_LENGTH = 8;

export interface CreatedApiKey {
  apiKey: ApiKey;
  /** The only copy of the key: shown once, never stored. */
  key: string;
}

@Injectable()
export class ApiKeyService {
  constructor(@InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>) {}

  async create(
    userId: string,
    name: string,
    expiresAt: Date | null = null
  ): Promise<CreatedApiKey> {
    const key = generateApiKey();
    const apiKey = await this.keys.save(
      this.keys.create({
        userId,
        name,
        keyHash: sha256Hex(key),
        prefix: key.slice(0, PREFIX_LENGTH),
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
      })
    );
    return { apiKey, key };
  }

  list(userId: string): Promise<ApiKey[]> {
    return this.keys.find({ where: { userId, revokedAt: IsNull() }, order: { createdAt: 'DESC' } });
  }

  /** True when the key belonged to the user and is now revoked. The owner check is part of the SQL. */
  async revoke(userId: string, id: string, now = new Date()): Promise<boolean> {
    const result = await this.keys.update({ id, userId, revokedAt: IsNull() }, { revokedAt: now });
    return (result.affected ?? 0) > 0;
  }

  /** The key with its user, or null when it is unknown, revoked or expired. */
  async resolve(key: string, now = new Date()): Promise<ApiKey | null> {
    const keyHash = sha256Hex(key);
    const found = await this.keys.findOne({
      where: [
        { keyHash, revokedAt: IsNull(), expiresAt: IsNull() },
        { keyHash, revokedAt: IsNull(), expiresAt: MoreThan(now) },
      ],
      relations: { user: true },
    });
    if (found === null) return null;
    await this.keys
      .createQueryBuilder()
      .update()
      .set({ lastUsedAt: now })
      .where('id = :id', { id: found.id })
      .andWhere('(last_used_at IS NULL OR last_used_at < :threshold)', {
        threshold: new Date(now.getTime() - TOUCH_INTERVAL_MS),
      })
      .execute();
    return found;
  }
}

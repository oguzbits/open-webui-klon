import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ProviderTarget } from './provider-adapter.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { SecretBox } from './secret-box.js';

@Injectable()
export class ProviderConnectionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly secretBox: SecretBox
  ) {}

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
}

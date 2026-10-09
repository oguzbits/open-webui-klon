import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

const TYPE_VALUES = Object.values(PROVIDER_TYPE)
  .map((type) => `'${type}'`)
  .join(', ');

/**
 * A connection to a model provider. The id is chosen by the service (not by the database) because it is part of
 * the authenticated data of the encrypted key. `apiKeyCiphertext` never leaves the service.
 */
@Entity({ name: 'provider_connection' })
@Index('provider_connection_name_idx', ['name'], { unique: true })
@Check('provider_connection_type_check', `type IN (${TYPE_VALUES})`)
export class ProviderConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: ProviderType;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  @Column({ name: 'api_key_ciphertext', type: 'text', nullable: true })
  apiKeyCiphertext!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** Raw model ids of the provider that the admin hides from users. */
  @Column({ name: 'hidden_model_ids', type: 'text', array: true, default: () => "'{}'" })
  hiddenModelIds!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

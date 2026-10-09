import type { DataSourceOptions } from 'typeorm';

import { ENTITIES } from './entities.js';
import { MIGRATIONS } from './migrations/index.js';

export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
    logging: ['error', 'warn'],
  };
}

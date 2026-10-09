import type { DataSourceOptions } from 'typeorm';

import { ENTITIES } from './entities.js';
import { MIGRATIONS } from './migrations/index.js';

export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    // gen_random_uuid() is built into Postgres; uuid-ossp would vanish with the test schema reset.
    uuidExtension: 'pgcrypto',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
    // The TypeORM console logger prints failed queries with their parameters (user content), past pino's
    // redaction. Failures surface as thrown errors and are logged through serializeError.
    logging: false,
  };
}

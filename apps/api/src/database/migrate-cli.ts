import { DataSource } from 'typeorm';

import { loadEnv } from '../config/env.js';
import { buildDataSourceOptions } from './data-source-options.js';
import { runMigrations } from './migrate.js';

async function main(): Promise<void> {
  const dataSource = new DataSource(buildDataSourceOptions(loadEnv().DATABASE_URL));
  await dataSource.initialize();
  try {
    const names = await runMigrations(dataSource);
    process.stdout.write(
      `${JSON.stringify({ level: 'info', msg: 'migrations applied', count: names.length, names })}\n`
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'migration failed', error: error instanceof Error ? error.message : 'unknown' })}\n`
  );
  process.exit(1);
});

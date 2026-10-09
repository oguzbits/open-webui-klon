import { Client } from 'pg';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from '../src/database/data-source-options.js';
import { runMigrations } from '../src/database/migrate.js';

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://owui:owui-dev-password@127.0.0.1:5433/owui_test';

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL_TEST ?? DEFAULT_TEST_DATABASE_URL;
}

/** Creates the test database if needed and rebuilds its schema from the migrations. */
export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  if (!name.endsWith('_test')) {
    // The schema is dropped below: never run this against a real database.
    throw new Error(`Refusing to reset database "${name}": test databases must end in "_test"`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/owui';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const dataSource = new DataSource(buildDataSourceOptions(url.toString()));
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await runMigrations(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

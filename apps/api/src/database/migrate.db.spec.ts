import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AUDIT_ACTION } from './audit/audit-action.js';
import { AuditLog } from './audit/audit-log.entity.js';
import { buildDataSourceOptions } from './data-source-options.js';
import { runMigrations } from './migrate.js';

describe('runMigrations (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('is idempotent: a second run applies nothing', async () => {
    expect(await runMigrations(dataSource)).toEqual([]);
  });

  it('recorded the first run in the audit log', async () => {
    const rows = await dataSource
      .getRepository(AuditLog)
      .findBy({ action: AUDIT_ACTION.SYSTEM_MIGRATED });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.metadata).toMatchObject({ migrations: expect.any(Array) });
  });
});

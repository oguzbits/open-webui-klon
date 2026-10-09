import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../data-source-options.js';
import { AUDIT_ACTION } from './audit-action.js';
import { AuditLog } from './audit-log.entity.js';
import { AuditService } from './audit.service.js';

describe('audit log (database)', () => {
  let dataSource: DataSource;
  let service: AuditService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new AuditService(dataSource.getRepository(AuditLog));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('stores an event with its context', async () => {
    const requestId = randomUUID();
    const actorId = randomUUID();

    await service.record({
      actorId,
      action: AUDIT_ACTION.SYSTEM_MIGRATED,
      targetType: 'schema',
      targetId: 'public',
      requestId,
      metadata: { reason: 'test' },
    });

    const rows = await dataSource.getRepository(AuditLog).findBy({ requestId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId,
      action: 'system.migrated',
      targetType: 'schema',
      targetId: 'public',
      metadata: { reason: 'test' },
    });
    expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it.each([
    ['UPDATE', "UPDATE audit_log SET action = 'tampered'"],
    ['DELETE', 'DELETE FROM audit_log'],
    ['TRUNCATE', 'TRUNCATE audit_log'],
  ])('refuses %s because the log is append-only', async (_name, statement) => {
    await expect(dataSource.query(statement)).rejects.toThrow(/append-only/);
  });

  it('has the pgvector extension and computes distances', async () => {
    const rows = await dataSource.query<{ distance: number }[]>(
      "SELECT ('[1,2,3]'::vector <-> '[1,2,4]'::vector) AS distance"
    );

    expect(rows[0]?.distance).toBe(1);
  });
});

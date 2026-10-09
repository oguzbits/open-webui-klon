import type { DataSource } from 'typeorm';

import { AUDIT_ACTION } from './audit/audit-action.js';
import { AuditLog } from './audit/audit-log.entity.js';

/** Applies pending migrations and records them in the audit log. Returns the applied names. */
export async function runMigrations(dataSource: DataSource): Promise<string[]> {
  const applied = await dataSource.runMigrations();
  const names = applied.map((migration) => migration.name);
  if (names.length > 0) {
    await dataSource.getRepository(AuditLog).insert({
      action: AUDIT_ACTION.SYSTEM_MIGRATED,
      metadata: { migrations: names },
    });
  }
  return names;
}

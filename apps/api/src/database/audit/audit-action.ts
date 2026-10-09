export const AUDIT_ACTION = {
  SYSTEM_MIGRATED: 'system.migrated',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

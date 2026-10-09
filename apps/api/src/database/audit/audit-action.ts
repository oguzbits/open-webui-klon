export const AUDIT_ACTION = {
  SYSTEM_MIGRATED: 'system.migrated',
  AUTH_SIGNUP: 'auth.signup',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  USER_CREATED: 'user.created',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DISABLED: 'user.disabled',
  USER_ENABLED: 'user.enabled',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_DELETED: 'user.deleted',
  API_KEY_CREATED: 'api_key.created',
  API_KEY_REVOKED: 'api_key.revoked',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

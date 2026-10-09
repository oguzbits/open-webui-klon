import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { ProviderConnection } from '../models/provider-connection.entity.js';
import { User } from '../users/user.entity.js';
import { AuditLog } from './audit/audit-log.entity.js';

export const ENTITIES = [AuditLog, User, Session, ApiKey, ProviderConnection];

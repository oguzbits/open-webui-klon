import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { Chat } from '../chats/chat.entity.js';
import { Message } from '../chats/message.entity.js';
import { Chunk } from '../knowledge/chunk.entity.js';
import { CollectionDocument } from '../knowledge/collection-document.entity.js';
import { Collection } from '../knowledge/collection.entity.js';
import { Document } from '../knowledge/document.entity.js';
import { ProviderConnection } from '../models/provider-connection.entity.js';
import { User } from '../users/user.entity.js';
import { AuditLog } from './audit/audit-log.entity.js';

export const ENTITIES = [
  AuditLog,
  User,
  Session,
  ApiKey,
  ProviderConnection,
  Chat,
  Message,
  Collection,
  Document,
  CollectionDocument,
  Chunk,
];

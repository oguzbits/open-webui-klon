import type { Request } from 'express';

import type { User } from '../users/user.entity.js';
import type { ApiKey } from './api-key.entity.js';
import type { Session } from './session.entity.js';

/** Who is calling and how: exactly one of `session` and `apiKey` is set. */
export interface AuthContext {
  user: User;
  session: Session | null;
  apiKey: ApiKey | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

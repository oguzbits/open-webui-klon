import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, type EntityManager, IsNull, Not } from 'typeorm';

import { Session } from '../auth/session.entity.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditService } from '../database/audit/audit.service.js';
import { FILE_STORAGE, type FileStorage } from '../knowledge/file-storage.js';
import { normalizeEmail } from './email.js';
import { User } from './user.entity.js';
import { USER_ROLE, type UserRole } from './user-role.js';

/** One advisory lock serializes every write that depends on how many users or admins exist. */
const USERS_LOCK_KEY = 7101;

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
}

export interface SignupPolicy {
  signupEnabled: boolean;
  defaultRole: typeof USER_ROLE.PENDING | typeof USER_ROLE.USER;
}

export interface UserPatch {
  name?: string;
  role?: UserRole;
  disabled?: boolean;
}

function isActiveAdmin(user: User): boolean {
  return user.role === USER_ROLE.ADMIN && user.disabledAt === null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(PinoLogger) private readonly logger: Pick<PinoLogger, 'setContext' | 'error'>
  ) {
    this.logger.setContext(UsersService.name);
  }

  findById(id: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOneBy({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOneBy({ email: normalizeEmail(email) });
  }

  list(): Promise<User[]> {
    return this.dataSource.getRepository(User).find({ order: { createdAt: 'ASC' } });
  }

  async hasAnyUser(): Promise<boolean> {
    return this.dataSource.getRepository(User).exists();
  }

  /** The first account ever becomes admin, whatever the sign-up setting; everybody else gets the default role. */
  async registerSelf(input: NewUser, policy: SignupPolicy): Promise<User> {
    const email = normalizeEmail(input.email);
    return this.withUserLock(async (manager) => {
      const existing = await manager.count(User);
      if (existing > 0 && !policy.signupEnabled) {
        throw new ForbiddenException('Sign-up is disabled');
      }
      await this.assertEmailFree(manager, email);
      return manager.save(
        manager.create(User, {
          email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: existing === 0 ? USER_ROLE.ADMIN : policy.defaultRole,
          disabledAt: null,
        })
      );
    });
  }

  async bootstrapAdmin(input: NewUser): Promise<User | null> {
    const email = normalizeEmail(input.email);
    const created = await this.withUserLock(async (manager) => {
      if ((await manager.count(User)) > 0) return null;
      return manager.save(
        manager.create(User, {
          email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: USER_ROLE.ADMIN,
          disabledAt: null,
        })
      );
    });
    if (created !== null) {
      await this.audit.record({
        action: AUDIT_ACTION.USER_CREATED,
        targetType: 'user',
        targetId: created.id,
        metadata: { role: USER_ROLE.ADMIN, source: 'environment' },
      });
    }
    return created;
  }

  async createByAdmin(actorId: string, input: NewUser & { role: UserRole }): Promise<User> {
    const email = normalizeEmail(input.email);
    const created = await this.withUserLock(async (manager) => {
      await this.assertEmailFree(manager, email);
      return manager.save(
        manager.create(User, {
          email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: input.role,
          disabledAt: null,
        })
      );
    });
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.USER_CREATED,
      targetType: 'user',
      targetId: created.id,
      metadata: { role: created.role },
    });
    return created;
  }

  async update(actorId: string, id: string, patch: UserPatch): Promise<User> {
    const { user, before } = await this.withUserLock(async (manager) => {
      const found = await manager.findOneBy(User, { id });
      if (found === null) throw new NotFoundException('User not found');
      const snapshot = { role: found.role, disabled: found.disabledAt !== null };

      const loosesAdmin =
        (patch.role !== undefined && patch.role !== USER_ROLE.ADMIN) || patch.disabled === true;
      if (isActiveAdmin(found) && loosesAdmin) await this.assertAnotherActiveAdmin(manager, id);

      if (patch.name !== undefined) found.name = patch.name;
      if (patch.role !== undefined) found.role = patch.role;
      if (patch.disabled !== undefined) found.disabledAt = patch.disabled ? new Date() : null;
      const saved = await manager.save(found);
      if (patch.disabled === true) await manager.delete(Session, { userId: id });
      return { user: saved, before: snapshot };
    });

    if (user.role !== before.role) {
      await this.audit.record({
        actorId,
        action: AUDIT_ACTION.USER_ROLE_CHANGED,
        targetType: 'user',
        targetId: id,
        metadata: { from: before.role, to: user.role },
      });
    }
    const disabled = user.disabledAt !== null;
    if (disabled !== before.disabled) {
      await this.audit.record({
        actorId,
        action: disabled ? AUDIT_ACTION.USER_DISABLED : AUDIT_ACTION.USER_ENABLED,
        targetType: 'user',
        targetId: id,
      });
    }
    return user;
  }

  async setPassword(id: string, passwordHash: string, keepSessionId?: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.update(User, { id }, { passwordHash });
      if ((result.affected ?? 0) === 0) throw new NotFoundException('User not found');
      await manager.delete(
        Session,
        keepSessionId === undefined ? { userId: id } : { userId: id, id: Not(keepSessionId) }
      );
    });
  }

  async resetPassword(actorId: string, id: string, passwordHash: string): Promise<void> {
    await this.setPassword(id, passwordHash);
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.USER_PASSWORD_RESET,
      targetType: 'user',
      targetId: id,
    });
  }

  async remove(actorId: string, id: string): Promise<void> {
    const files = await this.withUserLock(async (manager) => {
      const found = await manager.findOneBy(User, { id });
      if (found === null) throw new NotFoundException('User not found');
      if (isActiveAdmin(found)) await this.assertAnotherActiveAdmin(manager, id);
      // The rows of the documents go with the account (cascade); the files on disk need an explicit remove.
      const owned: { id: string; storage_key: string }[] = await manager.query(
        'SELECT id, storage_key FROM document WHERE user_id = $1',
        [id]
      );
      await manager.delete(User, { id });
      return owned;
    });
    for (const file of files) await this.removeFile(file.storage_key, file.id);
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.USER_DELETED,
      targetType: 'user',
      targetId: id,
    });
  }

  /** The account is already gone: a file that stays behind is logged (id only), not a reason to fail. */
  private async removeFile(storageKey: string, documentId: string): Promise<void> {
    try {
      await this.storage.remove(storageKey);
    } catch (error) {
      this.logger.error({
        documentId,
        errorName: error instanceof Error ? error.name : 'unknown',
        msg: 'could not remove a document file of a deleted account',
      });
    }
  }

  private withUserLock<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [USERS_LOCK_KEY]);
      return work(manager);
    });
  }

  private async assertEmailFree(manager: EntityManager, email: string): Promise<void> {
    if (await manager.existsBy(User, { email })) {
      throw new ConflictException('This email is already registered');
    }
  }

  private async assertAnotherActiveAdmin(
    manager: EntityManager,
    excludingId: string
  ): Promise<void> {
    const others = await manager.countBy(User, {
      role: USER_ROLE.ADMIN,
      disabledAt: IsNull(),
      id: Not(excludingId),
    });
    if (others === 0) throw new ConflictException('At least one active admin is required');
  }
}

import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditLog } from '../database/audit/audit-log.entity.js';
import { AuditService } from '../database/audit/audit.service.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { User } from './user.entity.js';
import { USER_ROLE } from './user-role.js';
import { UsersService } from './users.service.js';

const OPEN = { signupEnabled: true, defaultRole: USER_ROLE.PENDING } as const;

function person(name: string) {
  return { email: `${name}@example.com`, name, passwordHash: 'hash' };
}

describe('UsersService (database)', () => {
  let dataSource: DataSource;
  let service: UsersService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new UsersService(dataSource, new AuditService(dataSource.getRepository(AuditLog)));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetAuthTables(dataSource);
  });

  async function activeAdmins(): Promise<number> {
    return dataSource.getRepository(User).countBy({ role: USER_ROLE.ADMIN, disabledAt: IsNull() });
  }

  async function insertSession(userId: string): Promise<string> {
    const repository = dataSource.getRepository(Session);
    const saved = await repository.save(
      repository.create({
        userId,
        tokenHash: randomUUID(),
        csrfToken: 'csrf',
        expiresAt: new Date(Date.now() + 60_000),
      })
    );
    return saved.id;
  }

  describe('registerSelf', () => {
    it('makes the first account an admin even when sign-up is off, and stores the email normalized', async () => {
      const first = await service.registerSelf(
        { ...person('ada'), email: '  Ada@Example.COM ' },
        { signupEnabled: false, defaultRole: USER_ROLE.PENDING }
      );

      expect(first.role).toBe(USER_ROLE.ADMIN);
      expect(first.email).toBe('ada@example.com');
    });

    it('refuses later accounts while sign-up is off', async () => {
      await service.registerSelf(person('ada'), OPEN);

      await expect(
        service.registerSelf(person('bob'), { signupEnabled: false, defaultRole: USER_ROLE.USER })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each([USER_ROLE.PENDING, USER_ROLE.USER])(
      'gives later accounts the default role %s',
      async (role) => {
        await service.registerSelf(person('ada'), OPEN);

        const bob = await service.registerSelf(person('bob'), {
          signupEnabled: true,
          defaultRole: role,
        });

        expect(bob.role).toBe(role);
      }
    );

    it('treats the same email in another case as taken', async () => {
      await service.registerSelf(person('ada'), OPEN);

      await expect(
        service.registerSelf({ ...person('ada'), email: ' ADA@example.com' }, OPEN)
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates exactly one admin when five people register at the same moment', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) => service.registerSelf(person(`p${index}`), OPEN))
      );

      expect(results.filter((user) => user.role === USER_ROLE.ADMIN)).toHaveLength(1);
      expect(await dataSource.getRepository(User).count()).toBe(5);
    });
  });

  describe('bootstrapAdmin', () => {
    it('creates an admin only while there is no user, and audits it without personal data', async () => {
      const created = await service.bootstrapAdmin(person('root'));
      const second = await service.bootstrapAdmin(person('other'));

      expect(created?.role).toBe(USER_ROLE.ADMIN);
      expect(second).toBeNull();
      const audit = await dataSource
        .getRepository(AuditLog)
        .findBy({ action: AUDIT_ACTION.USER_CREATED, targetId: created?.id });
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0]?.metadata)).not.toContain('root@example.com');
    });
  });

  describe('createByAdmin', () => {
    it('creates an account with the given role and audits the actor', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      const created = await service.createByAdmin(admin.id, {
        ...person('bob'),
        role: USER_ROLE.USER,
      });

      expect(created.role).toBe(USER_ROLE.USER);
      const audit = await dataSource.getRepository(AuditLog).findBy({ targetId: created.id });
      expect(audit.map((row) => row.actorId)).toEqual([admin.id]);
    });

    it('refuses a known email', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      await service.createByAdmin(admin.id, { ...person('bob'), role: USER_ROLE.USER });

      await expect(
        service.createByAdmin(admin.id, { ...person('bob'), role: USER_ROLE.USER })
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('reports an unknown id', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await expect(service.update(admin.id, randomUUID(), { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('changes role and name and records the old and new role', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource, { role: USER_ROLE.PENDING });

      const updated = await service.update(admin.id, bob.id, { role: USER_ROLE.USER, name: 'Bob' });

      expect(updated).toMatchObject({ role: USER_ROLE.USER, name: 'Bob' });
      const audit = await dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: AUDIT_ACTION.USER_ROLE_CHANGED, targetId: bob.id });
      expect(audit.metadata).toEqual({ from: USER_ROLE.PENDING, to: USER_ROLE.USER });
      expect(audit.actorId).toBe(admin.id);
    });

    it('never demotes or disables the last active admin', async () => {
      const only = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await expect(
        service.update(only.id, only.id, { role: USER_ROLE.USER })
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.update(only.id, only.id, { disabled: true })).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(await activeAdmins()).toBe(1);
    });

    it('lets an admin step down when another active admin exists', async () => {
      const first = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await service.update(first.id, first.id, { role: USER_ROLE.USER });

      expect(await activeAdmins()).toBe(1);
    });

    it('does not count a disabled admin as the other admin', async () => {
      const first = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      await insertUser(dataSource, { role: USER_ROLE.ADMIN, disabledAt: new Date() });

      await expect(
        service.update(first.id, first.id, { role: USER_ROLE.USER })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('keeps at least one admin when two admins demote each other at the same moment', async () => {
      const a = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const b = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      const results = await Promise.allSettled([
        service.update(a.id, b.id, { role: USER_ROLE.USER }),
        service.update(b.id, a.id, { role: USER_ROLE.USER }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await activeAdmins()).toBe(1);
    });

    it('signs a disabled account out everywhere and lets it back in when enabled again', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource);
      await insertSession(bob.id);
      await insertSession(bob.id);

      const disabled = await service.update(admin.id, bob.id, { disabled: true });
      expect(disabled.disabledAt).toBeInstanceOf(Date);
      expect(await dataSource.getRepository(Session).countBy({ userId: bob.id })).toBe(0);

      const enabled = await service.update(admin.id, bob.id, { disabled: false });
      expect(enabled.disabledAt).toBeNull();
    });
  });

  describe('setPassword and resetPassword', () => {
    it('signs out every other session and keeps the named one', async () => {
      const bob = await insertUser(dataSource);
      const keep = await insertSession(bob.id);
      await insertSession(bob.id);

      await service.setPassword(bob.id, 'new-hash', keep);

      const remaining = await dataSource.getRepository(Session).findBy({ userId: bob.id });
      expect(remaining.map((row) => row.id)).toEqual([keep]);
      expect(
        (await dataSource.getRepository(User).findOneByOrFail({ id: bob.id })).passwordHash
      ).toBe('new-hash');
    });

    it('reports an unknown id', async () => {
      await expect(service.setPassword(randomUUID(), 'x')).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('resets as admin, signs everything out and audits', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource);
      await insertSession(bob.id);

      await service.resetPassword(admin.id, bob.id, 'reset-hash');

      expect(await dataSource.getRepository(Session).countBy({ userId: bob.id })).toBe(0);
      const audit = await dataSource
        .getRepository(AuditLog)
        .findBy({ action: AUDIT_ACTION.USER_PASSWORD_RESET, targetId: bob.id });
      expect(audit).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('deletes an account with its sessions and keys', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource);
      await insertSession(bob.id);
      await dataSource.getRepository(ApiKey).insert({
        userId: bob.id,
        name: 'ci',
        keyHash: randomUUID(),
        prefix: 'sk-abcde',
      });

      await service.remove(admin.id, bob.id);

      expect(await service.findById(bob.id)).toBeNull();
      expect(await dataSource.getRepository(Session).count()).toBe(0);
      expect(await dataSource.getRepository(ApiKey).count()).toBe(0);
    });

    it('never deletes the last active admin and reports unknown ids', async () => {
      const only = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await expect(service.remove(only.id, only.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.remove(only.id, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

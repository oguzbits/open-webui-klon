import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';
import { buildDataSourceOptions } from './data-source-options.js';

describe('auth schema (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE app_user CASCADE');
  });

  function newUser(email: string) {
    return dataSource.getRepository(User).insert({
      email,
      name: 'Test',
      passwordHash: 'hash',
      role: USER_ROLE.USER,
    });
  }

  it('stores a user with defaults', async () => {
    await newUser('ada@example.com');

    const user = await dataSource.getRepository(User).findOneByOrFail({ email: 'ada@example.com' });
    expect(user.disabledAt).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('refuses a second account with the same email', async () => {
    await newUser('ada@example.com');

    await expect(newUser('ada@example.com')).rejects.toThrow(/app_user_email_idx|duplicate key/);
  });

  it('refuses an unknown role', async () => {
    await expect(
      dataSource.query(
        "INSERT INTO app_user (email, name, password_hash, role) VALUES ('root@example.com', 'x', 'h', 'root')"
      )
    ).rejects.toThrow(/app_user_role_check/);
  });

  it('removes sessions and api keys together with the user', async () => {
    await newUser('ada@example.com');
    const user = await dataSource.getRepository(User).findOneByOrFail({ email: 'ada@example.com' });
    await dataSource.getRepository(Session).insert({
      userId: user.id,
      tokenHash: randomUUID(),
      csrfToken: 'csrf',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await dataSource.getRepository(ApiKey).insert({
      userId: user.id,
      name: 'ci',
      keyHash: randomUUID(),
      prefix: 'sk-abcde',
    });

    await dataSource.getRepository(User).delete({ id: user.id });

    expect(await dataSource.getRepository(Session).count()).toBe(0);
    expect(await dataSource.getRepository(ApiKey).count()).toBe(0);
  });
});

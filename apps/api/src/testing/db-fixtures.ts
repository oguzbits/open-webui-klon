import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';

/** Test databases are shared between spec files (they run one after another): start every test from zero users. */
export async function resetAuthTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE app_user CASCADE');
}

export async function insertUser(
  dataSource: DataSource,
  overrides: Partial<Pick<User, 'email' | 'name' | 'role' | 'passwordHash' | 'disabledAt'>> = {}
): Promise<User> {
  const repository = dataSource.getRepository(User);
  return repository.save(
    repository.create({
      email: `${randomUUID()}@example.com`,
      name: 'Test User',
      passwordHash: 'not-a-real-hash',
      role: USER_ROLE.USER,
      disabledAt: null,
      ...overrides,
    })
  );
}

export async function resetProviderTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE provider_connection');
}

import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH } from './password-policy.js';
import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with Argon2id and verifies', async () => {
    const hashed = await hasher.hash('correct horse battery');

    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(hashed, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hashed, 'wrong horse battery')).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    expect(await hasher.hash('correct horse battery')).not.toBe(
      await hasher.hash('correct horse battery')
    );
  });

  it('handles the longest allowed password and non-ASCII text', async () => {
    const long = 'ä'.repeat(PASSWORD_MAX_LENGTH);

    expect(await hasher.verify(await hasher.hash(long), long)).toBe(true);
  });

  it('never accepts an empty password for a real hash', async () => {
    expect(await hasher.verify(await hasher.hash('correct horse battery'), '')).toBe(false);
  });

  it('provides one reusable dummy hash that matches no realistic password', async () => {
    const first = await hasher.dummyHash();

    expect(await hasher.dummyHash()).toBe(first);
    expect(first.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(first, 'correct horse battery')).toBe(false);
  });
});

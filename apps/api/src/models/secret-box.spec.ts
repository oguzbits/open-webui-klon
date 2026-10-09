import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  parseKeyring,
  SECRET_BOX_ERROR,
  SecretBoxError,
} from './secret-box.js';

const keyEntry = (id: string, fill: number) => `${id}:${Buffer.alloc(32, fill).toString('base64')}`;

const ring = parseKeyring([keyEntry('k1', 1)]);
const CONNECTION = randomUUID();

function failureOf(work: () => unknown): SecretBoxError {
  try {
    work();
  } catch (error) {
    if (error instanceof SecretBoxError) return error;
    throw error;
  }
  throw new Error('expected SecretBoxError');
}

describe('SecretBox: format and round trip', () => {
  it('round-trips a secret and stores it as v1.<keyId>.<iv>.<ciphertext>', () => {
    const stored = encryptSecret('sk-provider-secret', ring, CONNECTION);

    expect(stored).toMatch(/^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain('sk-provider-secret');
    expect(decryptSecret(stored, ring, CONNECTION)).toBe('sk-provider-secret');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret('same', ring, CONNECTION)).not.toBe(
      encryptSecret('same', ring, CONNECTION)
    );
  });

  it('handles empty-looking and non-ASCII secrets', () => {
    for (const secret of ['x', 'ключ-密钥-🔑', 'a'.repeat(4096)]) {
      expect(decryptSecret(encryptSecret(secret, ring, CONNECTION), ring, CONNECTION)).toBe(secret);
    }
  });
});

describe('SecretBox: tampering and copying', () => {
  it('rejects a changed ciphertext, IV or key id', () => {
    const [version, keyId, iv, data] = encryptSecret('secret', ring, CONNECTION).split('.');
    const flip = (text = '') => `${text[0] === 'A' ? 'B' : 'A'}${text.slice(1)}`;

    for (const forged of [
      [version, keyId, iv, flip(data)],
      [version, keyId, flip(iv), data],
    ]) {
      expect(failureOf(() => decryptSecret(forged.join('.'), ring, CONNECTION)).code).toBe(
        SECRET_BOX_ERROR.TAMPERED
      );
    }
  });

  it('rejects a ciphertext copied into another connection', () => {
    const stored = encryptSecret('secret', ring, CONNECTION);

    expect(failureOf(() => decryptSecret(stored, ring, randomUUID())).code).toBe(
      SECRET_BOX_ERROR.TAMPERED
    );
  });

  it('rejects a key id that is not in the key ring', () => {
    const stored = encryptSecret('secret', ring, CONNECTION);
    const other = parseKeyring([keyEntry('k2', 2)]);

    expect(failureOf(() => decryptSecret(stored, other, CONNECTION)).code).toBe(
      SECRET_BOX_ERROR.UNKNOWN_KEY
    );
  });

  it('treats a key id swapped inside the stored value as tampering, not as another key', () => {
    const both = parseKeyring([keyEntry('k1', 1), keyEntry('k2', 2)]);
    const [version, , iv, data] = encryptSecret('secret', both, CONNECTION).split('.');

    expect(
      failureOf(() => decryptSecret([version, 'k2', iv, data].join('.'), both, CONNECTION)).code
    ).toBe(SECRET_BOX_ERROR.TAMPERED);
  });

  it.each([
    '',
    'plain text',
    'v1.k1.iv',
    'v2.k1.AAAAAAAAAAAAAAAA.AAAA',
    'v1.k1..AAAA',
    'v1.k1.AAAAAAAAAAAAAAAA.',
  ])('rejects the malformed value %j', (stored) => {
    expect(failureOf(() => decryptSecret(stored, ring, CONNECTION)).code).toBe(
      SECRET_BOX_ERROR.MALFORMED
    );
  });

  it('never puts the secret or the stored value into an error message', () => {
    const stored = encryptSecret('sk-provider-secret', ring, CONNECTION);
    const error = failureOf(() => decryptSecret(stored, ring, randomUUID()));

    expect(error.message).not.toContain('sk-provider-secret');
    expect(error.message).not.toContain(stored);
  });
});

describe('SecretBox: key rotation', () => {
  it('encrypts with the first key and still reads values of older keys', () => {
    const old = parseKeyring([keyEntry('old', 1)]);
    const rotated = parseKeyring([keyEntry('new', 2), keyEntry('old', 1)]);
    const legacy = encryptSecret('secret', old, CONNECTION);

    expect(decryptSecret(legacy, rotated, CONNECTION)).toBe('secret');
    expect(encryptSecret('secret', rotated, CONNECTION)).toMatch(/^v1\.new\./);
  });
});

describe('parseKeyring', () => {
  it('rejects a duplicate key id and a key of the wrong length', () => {
    expect(() => parseKeyring([keyEntry('k', 1), keyEntry('k', 2)])).toThrow(/duplicate/i);
    expect(() => parseKeyring([`k:${Buffer.alloc(16).toString('base64')}`])).toThrow(/32 bytes/);
  });

  it('rejects an empty list', () => {
    expect(() => parseKeyring([])).toThrow(/at least one/i);
  });
});

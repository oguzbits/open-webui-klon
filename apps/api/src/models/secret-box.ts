import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const SECRET_BOX_ERROR = {
  MALFORMED: 'malformed',
  UNKNOWN_KEY: 'unknown_key',
  TAMPERED: 'tampered',
} as const;

export type SecretBoxErrorCode = (typeof SECRET_BOX_ERROR)[keyof typeof SECRET_BOX_ERROR];

/** The message names the problem, never the secret or the stored value. */
export class SecretBoxError extends Error {
  constructor(
    readonly code: SecretBoxErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export interface KeyringEntry {
  keyId: string;
  key: Buffer;
}

export interface Keyring {
  /** Encrypts new values. */
  current: KeyringEntry;
  /** Decrypts every value, including those of older keys. */
  byId: ReadonlyMap<string, Buffer>;
}

/** Entries are `keyId:base64(32 bytes)`; the first one is the current key. */
export function parseKeyring(entries: readonly string[]): Keyring {
  const byId = new Map<string, Buffer>();
  let current: KeyringEntry | undefined;
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    const keyId = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (separator <= 0 || key.length !== KEY_BYTES) {
      throw new Error('Encryption keys must look like keyId:base64 and hold 32 bytes');
    }
    if (byId.has(keyId)) throw new Error(`Duplicate encryption key id "${keyId}"`);
    byId.set(keyId, key);
    current ??= { keyId, key };
  }
  if (current === undefined) throw new Error('At least one encryption key is required');
  return { current, byId };
}

/** Binds the ciphertext to its key and its row: a copy in another connection fails the tag check. */
function additionalData(keyId: string, connectionId: string): Buffer {
  return Buffer.from(`${VERSION}:${keyId}:${connectionId}`, 'utf8');
}

export function encryptSecret(plaintext: string, keyring: Keyring, connectionId: string): string {
  const { keyId, key } = keyring.current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(keyId, connectionId));
  const sealed = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return [VERSION, keyId, iv.toString('base64url'), sealed.toString('base64url')].join('.');
}

export function decryptSecret(stored: string, keyring: Keyring, connectionId: string): string {
  const [version, keyId, ivText, sealedText, ...rest] = stored.split('.');
  if (
    version !== VERSION ||
    keyId === undefined ||
    ivText === undefined ||
    sealedText === undefined ||
    rest.length > 0
  ) {
    throw new SecretBoxError(SECRET_BOX_ERROR.MALFORMED, 'Stored secret has an unknown format');
  }
  const key = keyring.byId.get(keyId);
  if (key === undefined) {
    throw new SecretBoxError(
      SECRET_BOX_ERROR.UNKNOWN_KEY,
      'No encryption key for the stored secret'
    );
  }
  const iv = Buffer.from(ivText, 'base64url');
  const sealed = Buffer.from(sealedText, 'base64url');
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) {
    throw new SecretBoxError(SECRET_BOX_ERROR.MALFORMED, 'Stored secret has an unknown format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(keyId, connectionId));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // The library error carries no secret, but it also says nothing a caller could act on.
    throw new SecretBoxError(SECRET_BOX_ERROR.TAMPERED, 'Stored secret failed verification');
  }
}

@Injectable()
export class SecretBox {
  private readonly keyring: Keyring;

  constructor(config: ConfigService<Env, true>) {
    // Fails at start-up when the configured keys are unusable (duplicate ids), not at the first request.
    this.keyring = parseKeyring(config.get('PROVIDER_KEY_ENCRYPTION_KEYS', { infer: true }));
  }

  encrypt(plaintext: string, connectionId: string): string {
    return encryptSecret(plaintext, this.keyring, connectionId);
  }

  decrypt(stored: string, connectionId: string): string {
    return decryptSecret(stored, this.keyring, connectionId);
  }
}

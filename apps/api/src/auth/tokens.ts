import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_PREFIX = 'sk-';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 256 bits, URL-safe: used for session tokens and CSRF tokens. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

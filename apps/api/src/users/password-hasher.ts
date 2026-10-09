import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Argon2id with the library defaults (m=19456 KiB, t=2, p=1: the OWASP minimum). A malformed stored hash makes
 * `verify` throw; that is a data problem and surfaces as a 500 instead of a silent "wrong password".
 */
@Injectable()
export class PasswordHasher {
  private dummy: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password);
  }

  verify(hashed: string, password: string): Promise<boolean> {
    return verify(hashed, password);
  }

  /** Verifying against this takes as long as a real check: used when the account does not exist. */
  dummyHash(): Promise<string> {
    this.dummy ??= hash('a password nobody has');
    return this.dummy;
  }
}

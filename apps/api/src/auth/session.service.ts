import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';

import type { Env } from '../config/env.js';
import { Session } from './session.entity.js';
import { generateToken, sha256Hex } from './tokens.js';

const TOUCH_INTERVAL_MS = 60_000;

export interface IssuedSession {
  id: string;
  /** The only copy of the token: it goes into the cookie and is never stored. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  private readonly lifetimeMs: number;

  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    config: ConfigService<Env, true>
  ) {
    this.lifetimeMs = config.get('SESSION_LIFETIME_HOURS', { infer: true }) * 3_600_000;
  }

  async issue(userId: string, now = new Date()): Promise<IssuedSession> {
    const token = generateToken();
    const csrfToken = generateToken();
    const expiresAt = new Date(now.getTime() + this.lifetimeMs);
    const row = await this.sessions.save(
      this.sessions.create({
        userId,
        tokenHash: sha256Hex(token),
        csrfToken,
        expiresAt,
        lastUsedAt: now,
      })
    );
    return { id: row.id, token, csrfToken, expiresAt };
  }

  /** The session with its user, or null when the token is unknown or expired. */
  async resolve(token: string, now = new Date()): Promise<Session | null> {
    const session = await this.sessions.findOne({
      where: { tokenHash: sha256Hex(token), expiresAt: MoreThan(now) },
      relations: { user: true },
    });
    if (session === null) return null;
    // Reads stay cheap: write the timestamp at most once per minute and session.
    await this.sessions.update(
      { id: session.id, lastUsedAt: LessThan(new Date(now.getTime() - TOUCH_INTERVAL_MS)) },
      { lastUsedAt: now }
    );
    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.delete({ id: sessionId });
  }

  async revokeToken(token: string): Promise<void> {
    await this.sessions.delete({ tokenHash: sha256Hex(token) });
  }

  /** Expired rows are removed when their owner signs in again; no background job needed. */
  async purgeExpired(userId: string, now = new Date()): Promise<void> {
    await this.sessions.delete({ userId, expiresAt: LessThan(now) });
  }
}

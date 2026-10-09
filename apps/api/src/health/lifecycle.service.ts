import { type BeforeApplicationShutdown, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';

/**
 * Nest calls onModuleDestroy first, then beforeApplicationShutdown, then closes the HTTP server.
 * Readiness turns red immediately; the pause gives the proxy time to stop sending new requests.
 */
@Injectable()
export class LifecycleService implements OnModuleDestroy, BeforeApplicationShutdown {
  private shuttingDown = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

  async beforeApplicationShutdown(): Promise<void> {
    const drainMs = this.config.get('SHUTDOWN_DRAIN_MS', { infer: true });
    if (drainMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, drainMs);
      });
    }
  }
}

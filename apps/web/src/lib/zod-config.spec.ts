import { config, z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import './zod-config';

describe('zod setup', () => {
  // The chat stream library validates with zod. Zod probes `new Function('')` to compile faster; under the
  // strict CSP (no unsafe-eval) the browser reports every probe as a violation, even though zod catches it.
  it('turns the compiling probe off so the CSP sees no eval attempt', () => {
    expect(config().jitless).toBe(true);
  });

  it('does not call the Function constructor when a schema parses', () => {
    const probe = vi.fn();
    const original = globalThis.Function;
    // A callable stand-in that records the call; zod only needs it to throw or be absent.
    globalThis.Function = new Proxy(original, {
      construct(target, args: unknown[]) {
        probe();
        return Reflect.construct(target, args) as object;
      },
      apply(target, thisArg, args: unknown[]) {
        probe();
        return Reflect.apply(target, thisArg, args) as unknown;
      },
    });
    try {
      z.object({ a: z.string() }).parse({ a: 'x' });
    } finally {
      globalThis.Function = original;
    }
    expect(probe).not.toHaveBeenCalled();
  });
});

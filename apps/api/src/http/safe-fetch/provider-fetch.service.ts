import { promises as dns, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';

import {
  type AllowedHost,
  canonicalHost,
  effectivePort,
  isAllowedHost,
  isProviderAddressAllowed,
} from './address-policy.js';
import { PROVIDER_ERROR, ProviderError } from './provider-error.js';

export const PROVIDER_FETCH_OPTIONS = Symbol('PROVIDER_FETCH_OPTIONS');

export interface ProviderFetchOptions {
  /** Connect, first byte and gap between chunks; also the total budget of a list request. */
  timeoutMs: number;
  maxJsonBytes: number;
  allowedHosts: readonly AllowedHost[];
  lookup: (hostname: string) => Promise<LookupAddress[]>;
}

export const PROVIDER_FETCH_DEFAULTS = {
  maxJsonBytes: 1024 * 1024,
  lookup: (hostname: string) => dns.lookup(hostname, { all: true, verbatim: true }),
} satisfies Partial<ProviderFetchOptions>;

/** What `createOpenAICompatible({ fetch })` expects. */
export type ProviderFetch = typeof globalThis.fetch;

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

const TIMEOUT_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
]);

/** Makes the socket connect to the address we validated instead of resolving the name again. */
function pinnedLookup({ address, family }: PinnedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

/** The stream types of undici leave the chunk type open; anything but bytes is a broken answer. */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider sent an unreadable answer');
}

/** undici wraps the real reason in `cause` ("fetch failed" -> ECONNREFUSED). */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    chain.push(current);
    current = 'cause' in current ? current.cause : undefined;
  }
  return chain;
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

/** A ProviderError stays, timeouts become TIMEOUT, a cancelled call stays as it is, everything else is UNREACHABLE. */
function providerFailure(error: unknown): unknown {
  if (error instanceof ProviderError) return error;
  const chain = causeChain(error);
  if (
    chain.some(
      (item) =>
        (item instanceof Error && item.name === 'TimeoutError') || TIMEOUT_CODES.has(codeOf(item))
    )
  ) {
    return new ProviderError(PROVIDER_ERROR.TIMEOUT, 'The provider did not answer in time');
  }
  if (chain.some((item) => item instanceof Error && item.name === 'AbortError')) return error;
  return new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'The provider is not reachable');
}

/**
 * Hands the connection (one pinned agent per call) back once the body is read, cancelled or failed.
 * Streams are not buffered: the chat reads them chunk by chunk.
 */
function releaseAgentWithBody(upstream: UndiciResponse, agent: Agent): Response {
  const headers = Array.from(upstream.headers.entries());
  const init = { status: upstream.status, statusText: upstream.statusText, headers };
  if (upstream.body === null) {
    void agent.close();
    return new Response(null, init);
  }
  const reader = upstream.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          await agent.close();
        } else {
          controller.enqueue(asBytes(next.value));
        }
      } catch (error) {
        controller.error(error);
        await agent.destroy();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await agent.destroy();
      }
    },
  });
  return new Response(body, init);
}

/**
 * The only way the API talks to a model provider (AGENTS.md rule 7). Per call: own DNS resolution, every resolved
 * address must pass the provider policy (private hosts only when listed in PROVIDER_ALLOWED_HOSTS; metadata and
 * link-local never), then the socket is pinned to that address. The target must have the origin of the connection,
 * and a redirect is an error, so a key never travels to another host.
 */
@Injectable()
export class ProviderFetchService {
  constructor(@Inject(PROVIDER_FETCH_OPTIONS) private readonly options: ProviderFetchOptions) {}

  /** Save-time check of a connection URL. Every later call checks again. */
  async assertHostAllowed(baseUrl: string): Promise<void> {
    await this.resolveAllowed(new URL(baseUrl));
  }

  /** A fetch that only reaches the origin of `baseUrl`; streams pass through. */
  createFetch(baseUrl: string): ProviderFetch {
    const origin = new URL(baseUrl).origin;
    const { timeoutMs } = this.options;
    return async (input, init) => {
      if (typeof input !== 'string' && !(input instanceof URL)) {
        throw new TypeError('The provider fetch accepts URLs only, not Request objects');
      }
      const target = new URL(input);
      if (target.origin !== origin) {
        throw new ProviderError(
          PROVIDER_ERROR.BLOCKED_HOST,
          'The target is not the host of the connection'
        );
      }
      const pinned = await this.resolveAllowed(target);
      const agent = new Agent({
        connect: { lookup: pinnedLookup(pinned), timeout: timeoutMs },
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
      let upstream: UndiciResponse;
      try {
        upstream = await undiciFetch(target, { ...init, redirect: 'manual', dispatcher: agent });
      } catch (error) {
        await agent.destroy();
        throw providerFailure(error);
      }
      if ((upstream.status >= 300 && upstream.status < 400) || upstream.type === 'opaqueredirect') {
        await agent.destroy();
        throw new ProviderError(
          PROVIDER_ERROR.BAD_RESPONSE,
          'The provider answered with a redirect'
        );
      }
      return releaseAgentWithBody(upstream, agent);
    };
  }

  /** GET `baseUrl + path` as JSON with a size limit, for the model lists. */
  async getJson(baseUrl: string, path: string, apiKey: string | undefined): Promise<unknown> {
    const { timeoutMs, maxJsonBytes } = this.options;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`;

    const response = await this.createFetch(baseUrl)(`${baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const rejection = this.rejectionFor(response);
    if (rejection !== undefined) {
      await response.body?.cancel();
      throw rejection;
    }
    const text = await this.readLimited(response, maxJsonBytes);
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is not JSON');
    }
  }

  private rejectionFor(response: Response): ProviderError | undefined {
    if (response.status === 401 || response.status === 403) {
      return new ProviderError(PROVIDER_ERROR.UNAUTHORIZED, 'The provider refused the key');
    }
    if (!response.ok) {
      return new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answered with an error');
    }
    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      return new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is not JSON');
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.options.maxJsonBytes) {
      return new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is too large');
    }
    return undefined;
  }

  private async readLimited(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is empty');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const bytes = asBytes(next.value);
        total += bytes.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is too large');
        }
        chunks.push(bytes);
      }
    } catch (error) {
      throw providerFailure(error);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private async resolveAllowed(target: URL): Promise<PinnedAddress> {
    // WHATWG URL already turned 2130706433, 0x7f.1 and [::ffff:127.0.0.1] into canonical IP literals.
    const host = canonicalHost(target.hostname);
    const hostIsAllowed = isAllowedHost(this.options.allowedHosts, host, effectivePort(target));
    let addresses: LookupAddress[];
    if (isIP(host) !== 0) {
      addresses = [{ address: host, family: host.includes(':') ? 6 : 4 }];
    } else {
      try {
        addresses = await this.options.lookup(host);
      } catch {
        throw new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'The host cannot be resolved');
      }
    }
    const first = addresses[0];
    if (first === undefined) {
      throw new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'The host cannot be resolved');
    }
    // Every address must pass: the resolver may return a public and a private one.
    if (!addresses.every(({ address }) => isProviderAddressAllowed(address, hostIsAllowed))) {
      throw new ProviderError(PROVIDER_ERROR.BLOCKED_HOST, 'The host is not allowed');
    }
    return { address: first.address, family: first.family === 6 ? 6 : 4 };
  }
}

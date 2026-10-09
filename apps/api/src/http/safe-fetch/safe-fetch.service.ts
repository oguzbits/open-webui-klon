import { Inject, Injectable } from '@nestjs/common';
import ipaddr from 'ipaddr.js';
import { promises as dns, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, request } from 'undici';

import { SAFE_FETCH_ERROR, SafeFetchError } from './errors.js';
import { isPublicAddress } from './ip-policy.js';

export const SAFE_FETCH_OPTIONS = Symbol('SAFE_FETCH_OPTIONS');

export interface SafeFetchOptions {
  maxRedirects: number;
  maxBytes: number;
  /** Total budget for the whole call including redirects. */
  timeoutMs: number;
  allowedContentTypes: readonly string[];
  isAllowedAddress: (address: string) => boolean;
  lookup: (hostname: string) => Promise<LookupAddress[]>;
}

export const SAFE_FETCH_DEFAULTS: SafeFetchOptions = {
  maxRedirects: 3,
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 10_000,
  allowedContentTypes: ['text/html', 'text/plain', 'application/json'],
  isAllowedAddress: isPublicAddress,
  lookup: (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
};

export interface SafeFetchResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

type Hop =
  | { kind: 'redirect'; location: string }
  | { kind: 'done'; response: Omit<SafeFetchResponse, 'url'> };

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'open-webui-klon-fetch/1.0';

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError(SAFE_FETCH_ERROR.INVALID_URL, 'Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError(
      SAFE_FETCH_ERROR.BLOCKED_SCHEME,
      `Scheme ${url.protocol} is not allowed`
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError(
      SAFE_FETCH_ERROR.CREDENTIALS_IN_URL,
      'Credentials in URLs are not allowed'
    );
  }
  return url;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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

function toSafeFetchError(error: unknown): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  const name = error instanceof Error ? error.name : '';
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const timedOut =
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    [
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_ABORTED',
    ].includes(code);
  return timedOut
    ? new SafeFetchError(SAFE_FETCH_ERROR.TIMEOUT, 'Request timed out')
    : new SafeFetchError(SAFE_FETCH_ERROR.UPSTREAM_ERROR, 'Request failed');
}

/**
 * The only way the API fetches URLs it did not choose itself (URL import, tools, web search).
 * Per hop: scheme check, own DNS resolution, every resolved address must pass the policy, then the
 * connection is pinned to that validated address. Redirects are followed manually and validated again.
 */
@Injectable()
export class SafeFetchService {
  constructor(@Inject(SAFE_FETCH_OPTIONS) private readonly options: SafeFetchOptions) {}

  async fetch(rawUrl: string): Promise<SafeFetchResponse> {
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    try {
      let target = parseHttpUrl(rawUrl);
      for (let redirects = 0; ; redirects += 1) {
        const pinned = await this.resolveAllowed(target);
        const hop = await this.requestOnce(target, pinned, signal);
        if (hop.kind === 'done') return { url: target.toString(), ...hop.response };
        if (redirects >= this.options.maxRedirects) {
          throw new SafeFetchError(SAFE_FETCH_ERROR.TOO_MANY_REDIRECTS, 'Too many redirects');
        }
        target = this.nextTarget(target, hop.location);
      }
    } catch (error) {
      throw toSafeFetchError(error);
    }
  }

  private nextTarget(current: URL, location: string): URL {
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new SafeFetchError(SAFE_FETCH_ERROR.BAD_REDIRECT, 'Invalid redirect target');
    }
    return parseHttpUrl(next);
  }

  private async resolveAllowed(target: URL): Promise<PinnedAddress> {
    // WHATWG URL already turned 2130706433, 0x7f.1, 127.1 and [::ffff:127.0.0.1] into canonical IP literals.
    const host = target.hostname.replace(/^\[|\]$/g, '');
    let addresses: LookupAddress[];
    if (ipaddr.isValid(host)) {
      addresses = [{ address: host, family: host.includes(':') ? 6 : 4 }];
    } else {
      try {
        addresses = await this.options.lookup(host);
      } catch {
        throw new SafeFetchError(SAFE_FETCH_ERROR.DNS_FAILED, `Cannot resolve ${host}`);
      }
    }
    const first = addresses[0];
    if (first === undefined) {
      throw new SafeFetchError(SAFE_FETCH_ERROR.DNS_FAILED, `Cannot resolve ${host}`);
    }
    // Every address must pass: the resolver may return a public and a private one.
    if (!addresses.every(({ address }) => this.options.isAllowedAddress(address))) {
      throw new SafeFetchError(
        SAFE_FETCH_ERROR.BLOCKED_ADDRESS,
        `Address of ${host} is not allowed`
      );
    }
    return { address: first.address, family: first.family === 6 ? 6 : 4 };
  }

  private async requestOnce(target: URL, pinned: PinnedAddress, signal: AbortSignal): Promise<Hop> {
    const { timeoutMs, maxBytes, allowedContentTypes } = this.options;
    const agent = new Agent({ connect: { lookup: pinnedLookup(pinned) } });
    try {
      const response = await request(target, {
        dispatcher: agent,
        method: 'GET',
        signal,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headers: { 'accept-encoding': 'identity', 'user-agent': USER_AGENT },
      });

      const location = firstHeader(response.headers.location);
      if (REDIRECT_STATUS.has(response.statusCode) && location !== undefined) {
        // dump() discards the body without raising an unhandled 'error' event (destroy() does).
        await response.body.dump();
        return { kind: 'redirect', location };
      }

      const contentType =
        (firstHeader(response.headers['content-type']) ?? '').split(';')[0]?.trim().toLowerCase() ??
        '';
      if (!allowedContentTypes.includes(contentType)) {
        throw new SafeFetchError(
          SAFE_FETCH_ERROR.CONTENT_TYPE_NOT_ALLOWED,
          `Content type ${contentType || '(none)'} is not allowed`
        );
      }
      const declared = Number(firstHeader(response.headers['content-length']));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new SafeFetchError(SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE, 'Response is too large');
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw new SafeFetchError(SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE, 'Response is too large');
        }
        chunks.push(Buffer.from(chunk));
      }
      return {
        kind: 'done',
        response: { status: response.statusCode, contentType, body: Buffer.concat(chunks) },
      };
    } finally {
      await agent.destroy();
    }
  }
}

import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

const PORT =
  '(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3})';

/** `host`, `host:port`, `[v6]` or `[v6]:port` (a path, wildcard or scheme is not an allow-list entry). */
export const ALLOWED_HOST_PATTERN = new RegExp(
  `^(\\[[0-9a-fA-F:.]+\\]|[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)(:${PORT})?$`
);

export interface AllowedHost {
  hostname: string;
  /** Without a port the entry matches every port. */
  port: number | undefined;
}

/** Lower-case; IP literals in one spelling, so "::1" and "0:0:0:0:0:0:0:1" compare equal. */
export function canonicalHost(host: string): string {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return isIP(bare) !== 0 ? ipaddr.parse(bare).toNormalizedString() : bare;
}

/** Entries are validated by ALLOWED_HOST_PATTERN in env.ts before they get here. */
export function parseAllowedHost(entry: string): AllowedHost {
  const match = /^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$/.exec(entry.trim());
  const host = match?.[1];
  if (host === undefined) throw new Error('Not a host or host:port entry');
  const port = match?.[2];
  return { hostname: canonicalHost(host), port: port === undefined ? undefined : Number(port) };
}

export function isAllowedHost(
  allowed: readonly AllowedHost[],
  hostname: string,
  port: number
): boolean {
  const host = canonicalHost(hostname);
  return allowed.some(
    (entry) => entry.hostname === host && (entry.port === undefined || entry.port === port)
  );
}

/** WHATWG URL drops default ports, so `url.port` is empty for http://host and https://host. */
export function effectivePort(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/** Never reachable for a provider, even when the admin listed the host: metadata, link-local, wildcard, multicast. */
const NEVER_ALLOWED_RANGES = new Set(['linkLocal', 'unspecified', 'broadcast', 'multicast']);

/**
 * Judges one resolved address. A host the admin put on PROVIDER_ALLOWED_HOSTS may be private or loopback; every
 * other host must resolve to public addresses only. IPv4-mapped IPv6 addresses count as the IPv4 address inside.
 */
export function isProviderAddressAllowed(address: string, hostIsAllowed: boolean): boolean {
  // ipaddr.js also accepts legacy spellings such as "1.2.3"; only strict dotted/colon notation counts.
  if (isIP(address) === 0) return false;
  const parsed = ipaddr.parse(address);
  const effective =
    parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address()
      : parsed;
  const range = effective.range();
  if (NEVER_ALLOWED_RANGES.has(range)) return false;
  return hostIsAllowed || range === 'unicast';
}

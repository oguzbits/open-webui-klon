import ipaddr from 'ipaddr.js';

/**
 * Allow-list by construction: only globally routable unicast addresses pass. Loopback, private,
 * link-local (cloud metadata), carrier-grade NAT, multicast, documentation, 6to4/NAT64/Teredo and
 * every other special range are reported by ipaddr.js under a name other than "unicast".
 * IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) are judged by the IPv4 address inside.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  const effective =
    parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address()
      : parsed;
  return effective.range() === 'unicast';
}

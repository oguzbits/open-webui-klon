import { describe, expect, it } from 'vitest';

import { isPublicAddress } from './ip-policy.js';

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e'])(
    'allows the public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    }
  );

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback range', '127.255.255.254'],
    ['unspecified', '0.0.0.0'],
    ['private 10/8', '10.0.0.5'],
    ['private 172.16/12', '172.16.0.1'],
    ['private 192.168/16', '192.168.1.1'],
    ['cloud metadata (link-local)', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['documentation range', '203.0.113.7'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique local', 'fc00::1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['IPv4-mapped loopback (dotted)', '::ffff:127.0.0.1'],
    ['IPv4-mapped loopback (hex)', '::ffff:7f00:1'],
    ['IPv4-mapped private', '::ffff:10.0.0.5'],
    ['NAT64 with loopback', '64:ff9b::7f00:1'],
    ['6to4', '2002:7f00:1::1'],
    ['not an address', 'example.com'],
    ['empty', ''],
  ])('blocks %s (%s)', (_name, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

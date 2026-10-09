import { describe, expect, it } from 'vitest';

import {
  ALLOWED_HOST_PATTERN,
  canonicalHost,
  effectivePort,
  isAllowedHost,
  isProviderAddressAllowed,
  parseAllowedHost,
} from './address-policy.js';

describe('isProviderAddressAllowed', () => {
  it.each([
    ['93.184.216.34', false, true],
    ['2606:2800:220:1:248:1893:25c8:1946', false, true],
    ['10.0.0.5', false, false],
    ['172.16.0.1', false, false],
    ['192.168.1.10', false, false],
    ['127.0.0.1', false, false],
    ['100.64.0.1', false, false],
    ['::1', false, false],
    ['fd00::1', false, false],
    ['::ffff:127.0.0.1', false, false],
    ['::ffff:10.0.0.5', false, false],
    ['10.0.0.5', true, true],
    ['192.168.1.10', true, true],
    ['127.0.0.1', true, true],
    ['::1', true, true],
    ['fd00::1', true, true],
    ['::ffff:10.0.0.5', true, true],
  ])('address %s, host on the list: %s -> %s', (address, listed, expected) => {
    expect(isProviderAddressAllowed(address, listed)).toBe(expected);
  });

  it.each([
    '169.254.169.254',
    '169.254.0.1',
    '::ffff:169.254.169.254',
    'fe80::1',
    '0.0.0.0',
    '0.1.2.3',
    '::',
    '224.0.0.1',
    'ff02::1',
    '255.255.255.255',
  ])('never allows %s, not even for a host on the list', (address) => {
    expect(isProviderAddressAllowed(address, true)).toBe(false);
    expect(isProviderAddressAllowed(address, false)).toBe(false);
  });

  it.each(['', 'not-an-ip', '999.1.1.1', '1.2.3'])('refuses the non-address %j', (address) => {
    expect(isProviderAddressAllowed(address, true)).toBe(false);
  });
});

describe('allowed hosts', () => {
  const allowed = [
    'ollama',
    'Host.Docker.Internal',
    'localhost:11434',
    '[::1]:11434',
    '10.0.0.7',
  ].map(parseAllowedHost);

  it('matches a host without port on every port, case-insensitively', () => {
    expect(isAllowedHost(allowed, 'ollama', 11434)).toBe(true);
    expect(isAllowedHost(allowed, 'ollama', 80)).toBe(true);
    expect(isAllowedHost(allowed, 'host.docker.internal', 8000)).toBe(true);
    expect(isAllowedHost(allowed, 'OLLAMA', 1)).toBe(true);
  });

  it('matches host:port only on that port', () => {
    expect(isAllowedHost(allowed, 'localhost', 11434)).toBe(true);
    expect(isAllowedHost(allowed, 'localhost', 11435)).toBe(false);
  });

  it('compares IP literals in one canonical spelling', () => {
    expect(isAllowedHost(allowed, '::1', 11434)).toBe(true);
    expect(isAllowedHost(allowed, '[::1]', 11434)).toBe(true);
    expect(isAllowedHost(allowed, '0:0:0:0:0:0:0:1', 11434)).toBe(true);
    expect(isAllowedHost(allowed, '10.0.0.7', 1234)).toBe(true);
  });

  it('does not match a name that merely contains an entry', () => {
    expect(isAllowedHost(allowed, 'ollama.evil.test', 11434)).toBe(false);
    expect(isAllowedHost(allowed, 'evil-ollama', 11434)).toBe(false);
    expect(isAllowedHost([], 'ollama', 11434)).toBe(false);
  });

  it('picks the effective port of a URL', () => {
    expect(effectivePort(new URL('http://a.test'))).toBe(80);
    expect(effectivePort(new URL('https://a.test'))).toBe(443);
    expect(effectivePort(new URL('http://a.test:8080'))).toBe(8080);
    expect(effectivePort(new URL('http://a.test:80'))).toBe(80);
  });

  it('canonicalizes hosts', () => {
    expect(canonicalHost('Example.COM')).toBe('example.com');
    expect(canonicalHost('[::1]')).toBe('0:0:0:0:0:0:0:1');
  });

  it.each(['ollama', 'ollama:11434', '[::1]', '[::1]:11434', 'a.b-c.d:1', '10.0.0.1:65535'])(
    'accepts %s as an entry',
    (entry) => {
      expect(ALLOWED_HOST_PATTERN.test(entry)).toBe(true);
    }
  );

  it.each([
    '',
    'http://ollama',
    'ollama/path',
    '*.example.com',
    'a b',
    'ollama:0',
    'ollama:65536',
    '-ollama',
    'ollama:',
  ])('rejects %j as an entry', (entry) => {
    expect(ALLOWED_HOST_PATTERN.test(entry)).toBe(false);
  });
});

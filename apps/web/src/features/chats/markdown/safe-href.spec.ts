import { describe, expect, it } from 'vitest';

import { safeHref, safeUrlTransform } from './safe-href';

describe('safeHref', () => {
  it.each([
    ['https://example.test/a?b=1#c', 'https://example.test/a?b=1#c'],
    ['http://example.test/', 'http://example.test/'],
    ['mailto:ben@example.test', 'mailto:ben@example.test'],
  ])('lets %s through', (url, expected) => {
    expect(safeHref(url)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    '\tjavascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.test/x',
    'tel:+491234',
    '/relative/path',
    '//example.test/x',
    '#anchor',
    '',
  ])('refuses %j', (url) => {
    expect(safeHref(url)).toBeUndefined();
  });

  it('refuses a missing url', () => {
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe('safeUrlTransform', () => {
  it('answers an empty string for an unsafe url, so no attribute is set', () => {
    expect(safeUrlTransform('javascript:alert(1)')).toBe('');
    expect(safeUrlTransform('https://example.test/')).toBe('https://example.test/');
  });
});

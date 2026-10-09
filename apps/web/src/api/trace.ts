function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** W3C Trace Context: the API continues this trace, so a click can be followed into the backend. */
export function createTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

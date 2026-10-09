/** Emails are compared and stored lower-case, so "Ada@Example.com " and "ada@example.com" are one account. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** class-transformer hook; non-strings pass through so the validator reports them. */
export function emailTransform({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeEmail(value) : value;
}

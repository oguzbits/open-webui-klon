/** The only schemes a link out of model output may use. Everything else (javascript:, data:, relative paths) is text. */
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The normalised URL if it is absolute and uses a safe scheme, otherwise `undefined`. */
export function safeHref(url: string | undefined): string | undefined {
  if (url === undefined || !URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : undefined;
}

/** For `react-markdown`'s `urlTransform`: an unsafe URL becomes empty, so the component sees no `href` or `src`. */
export function safeUrlTransform(url: string): string {
  return safeHref(url) ?? '';
}

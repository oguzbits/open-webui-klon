const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let csrfToken: string | undefined;
let unauthorizedHandler: (() => void) | undefined;

/** The server hands the token out with the session (me, login, signup); the fetcher sends it back on writes. */
export function rememberCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export function csrfHeaderFor(method: string): string | undefined {
  return SAFE_METHODS.has(method.toUpperCase()) ? undefined : csrfToken;
}

/** The app registers what happens when an ordinary request learns that the session is gone. */
export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

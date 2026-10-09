// Checks a running stack from the outside. Usage: node scripts/smoke.mjs [BASE_URL]  (or set BASE_URL; it must match PUBLIC_ORIGIN, or the origin check refuses the POST checks)
const BASE_URL = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:8080';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000);

const failures = [];

function check(name, condition) {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    console.log(`FAIL ${name}`);
    failures.push(name);
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health/ready`);
      if (response.ok) return;
    } catch {
      // not reachable yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Stack not ready after ${TIMEOUT_MS} ms: ${BASE_URL}/api/health/ready`);
}

await waitUntilReady();

const ready = await fetch(`${BASE_URL}/api/health/ready`);
check(
  'readiness answers 200 with status ok',
  ready.status === 200 && (await ready.json()).status === 'ok'
);

const page = await fetch(`${BASE_URL}/`);
const html = await page.text();
const pageCsp = page.headers.get('content-security-policy') ?? '';
check('start page is HTML with the React root', page.status === 200 && html.includes('id="root"'));
check("page CSP restricts scripts to 'self'", pageCsp.includes("script-src 'self'"));
check('page CSP does not allow inline scripts', !/script-src[^;]*unsafe-inline/.test(pageCsp));
check('page sends nosniff', page.headers.get('x-content-type-options') === 'nosniff');
check('proxy does not announce its version', !page.headers.has('server'));

const deepLink = await fetch(`${BASE_URL}/some/deep/link`);
check(
  'unknown front-end path falls back to the app',
  deepLink.status === 200 && (await deepLink.text()).includes('id="root"')
);

const live = await fetch(`${BASE_URL}/api/health/live`);
check(
  "API keeps its own CSP (default-src 'none')",
  (live.headers.get('content-security-policy') ?? '').includes("default-src 'none'")
);

const missing = await fetch(`${BASE_URL}/api/does-not-exist`);
check(
  'unknown API path answers problem details with a request id',
  missing.status === 404 &&
    (missing.headers.get('content-type') ?? '').includes('application/problem+json') &&
    Boolean(missing.headers.get('x-request-id'))
);

const preflight = await fetch(`${BASE_URL}/api/health/live`, {
  method: 'OPTIONS',
  headers: { origin: 'http://evil.test', 'access-control-request-method': 'GET' },
});
check(
  'CORS: a foreign origin gets no allow header',
  !preflight.headers.has('access-control-allow-origin')
);

const anonymousMe = await fetch(`${BASE_URL}/api/auth/me`);
check(
  'anonymous /auth/me answers 401 problem details',
  anonymousMe.status === 401 &&
    (anonymousMe.headers.get('content-type') ?? '').includes('application/problem+json')
);

const anonymousUsers = await fetch(`${BASE_URL}/api/users`);
check('anonymous /users answers 401', anonymousUsers.status === 401);

const authConfig = await fetch(`${BASE_URL}/api/auth/config`);
check(
  'public auth config answers 200 without a login',
  authConfig.status === 200 && 'signupEnabled' in (await authConfig.json())
);

const badSignup = await fetch(`${BASE_URL}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE_URL },
  body: '{}',
});
check(
  'invalid sign-up answers 400 and sets no cookie',
  badSignup.status === 400 && !badSignup.headers.has('set-cookie')
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke test passed');

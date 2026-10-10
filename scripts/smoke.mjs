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

const anonymousModels = await fetch(`${BASE_URL}/api/models`);
check('anonymous /models answers 401', anonymousModels.status === 401);

const anonymousConnections = await fetch(`${BASE_URL}/api/admin/provider-connections`);
check(
  'anonymous /admin/provider-connections answers 401 problem details',
  anonymousConnections.status === 401 &&
    (anonymousConnections.headers.get('content-type') ?? '').includes('application/problem+json')
);

const chatsWithoutSession = await fetch(`${BASE_URL}/api/chats`);
check('chat list needs a session', chatsWithoutSession.status === 401);

const collectionsWithoutSession = await fetch(`${BASE_URL}/api/collections`);
check('collection list needs a session', collectionsWithoutSession.status === 401);

const uploadWithoutSession = await fetch(`${BASE_URL}/api/documents`, {
  method: 'POST',
  headers: { origin: BASE_URL },
});
check('document upload needs a session', uploadWithoutSession.status === 401);

const streamWithoutSession = await fetch(
  `${BASE_URL}/api/chats/00000000-0000-4000-8000-000000000000/stream`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ parentId: null, text: 'x' }),
  }
);
check('chat stream needs a session', streamWithoutSession.status === 401);

// Knowledge: needs an active account, a chat model and the embedding model of the stack. Skipped without them.
const { SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_MODEL_ID, EMBEDDING_MODEL_ID } = process.env;
if (SMOKE_EMAIL && SMOKE_PASSWORD && SMOKE_MODEL_ID && EMBEDDING_MODEL_ID) {
  await smokeKnowledge();
} else {
  console.log(
    'skip knowledge checks (set SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_MODEL_ID and EMBEDDING_MODEL_ID to run them)'
  );
}

async function smokeKnowledge() {
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
  });
  const session = login.ok ? await login.json() : undefined;
  check('knowledge: login works', session !== undefined && typeof session.csrfToken === 'string');
  if (session === undefined) return;
  const cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  const headers = { cookie, origin: BASE_URL, 'x-csrf-token': session.csrfToken };
  const json = { ...headers, 'content-type': 'application/json' };

  const collection = await (
    await fetch(`${BASE_URL}/api/collections`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: `smoke-${Date.now()}` }),
    })
  ).json();
  let chatId;
  try {
    const form = new FormData();
    form.append('collectionId', collection.id);
    form.append(
      'file',
      new Blob(['# Smoke\n\nDer Leuchtturm Rothenwind hat die Kennung Blitz 5.'], {
        type: 'text/markdown',
      }),
      'smoke.md'
    );
    const upload = await fetch(`${BASE_URL}/api/documents`, {
      method: 'POST',
      headers,
      body: form,
    });
    check('knowledge: upload is accepted', upload.status === 201);

    const deadline = Date.now() + TIMEOUT_MS;
    let status = 'pending';
    while (Date.now() < deadline && ['pending', 'processing'].includes(status)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const list = await (
        await fetch(`${BASE_URL}/api/collections/${collection.id}/documents`, { headers })
      ).json();
      status = list.items?.[0]?.status ?? 'missing';
    }
    check(`knowledge: document becomes ready (was ${status})`, status === 'ready');

    const chat = await (
      await fetch(`${BASE_URL}/api/chats`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ modelId: SMOKE_MODEL_ID }),
      })
    ).json();
    chatId = chat.id;
    await fetch(`${BASE_URL}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ collectionIds: [collection.id] }),
    });
    const stream = await fetch(`${BASE_URL}/api/chats/${chatId}/stream`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ parentId: null, text: 'Welche Kennung hat der Leuchtturm?' }),
    });
    const body = await stream.text();
    const start = body
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)))
      .find((event) => event.type === 'start');
    check(
      'knowledge: the stream announces the sources',
      stream.status === 200 && Array.isArray(start?.messageMetadata?.sources)
    );
  } finally {
    if (chatId) await fetch(`${BASE_URL}/api/chats/${chatId}`, { method: 'DELETE', headers });
    const list = await fetch(`${BASE_URL}/api/collections/${collection.id}/documents`, { headers });
    for (const item of (await list.json()).items ?? []) {
      await fetch(`${BASE_URL}/api/documents/${item.id}`, { method: 'DELETE', headers });
    }
    await fetch(`${BASE_URL}/api/collections/${collection.id}`, { method: 'DELETE', headers });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke test passed');

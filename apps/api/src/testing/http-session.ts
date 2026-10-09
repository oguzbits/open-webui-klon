import request from 'supertest';

export type Http = ReturnType<typeof request>;

export const TEST_PASSWORD = 'correct horse battery';

export interface Login {
  cookie: string;
  csrf: string;
  user: { id: string; email: string; name: string; role: string };
}

/** "session=abc" from the Set-Cookie header, ready to send back as Cookie. */
export function cookieFrom(response: request.Response): string {
  const raw: unknown = response.headers['set-cookie'];
  const first: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response set no cookie');
  return first.split(';')[0] ?? '';
}

function loginFrom(response: request.Response): Login {
  return { cookie: cookieFrom(response), csrf: response.body.csrfToken, user: response.body.user };
}

export async function signupUser(
  http: Http,
  body: { email: string; name?: string; password?: string },
  expected = 201
): Promise<Login> {
  const response = await http
    .post('/api/auth/signup')
    .send({ name: 'Test User', password: TEST_PASSWORD, ...body })
    .expect(expected);
  return loginFrom(response);
}

export async function loginUser(http: Http, email: string, password: string): Promise<Login> {
  const response = await http.post('/api/auth/login').send({ email, password }).expect(200);
  return loginFrom(response);
}

/** Requests as a signed-in browser: the cookie always, the CSRF header on writes. */
export function authed(http: Http, login: Login) {
  return {
    get: (url: string) => http.get(url).set('Cookie', login.cookie),
    post: (url: string) =>
      http.post(url).set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf),
    patch: (url: string) =>
      http.patch(url).set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf),
    delete: (url: string) =>
      http.delete(url).set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf),
  };
}

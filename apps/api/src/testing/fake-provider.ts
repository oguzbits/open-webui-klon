import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_MODE = {
  OK: 'ok',
  UNAUTHORIZED: 'unauthorized',
  SERVER_ERROR: 'server_error',
  REDIRECT: 'redirect',
  HANG: 'hang',
  HTML: 'html',
  GARBAGE: 'garbage',
  WRONG_SHAPE: 'wrong_shape',
  OVERSIZED: 'oversized',
  OVERSIZED_STREAM: 'oversized_stream',
} as const;

export type FakeMode = (typeof FAKE_MODE)[keyof typeof FAKE_MODE];

export interface FakeRequest {
  method: string;
  path: string;
  host: string | undefined;
  authorization: string | undefined;
  body: string;
}

const OVERSIZED_BYTES = 4096;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function completion(model: string, content: string): string {
  return JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function chunk(model: string, delta: object, finish: string | null): string {
  const payload = {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A model provider for tests and hand checks: Ollama (`/api/tags`) and OpenAI format (`/v1/models`,
 * `/v1/chat/completions`, also as a stream). `mode` switches every answer to one kind of failure.
 */
export class FakeProvider {
  mode: FakeMode = FAKE_MODE.OK;
  models: string[] = ['llama3:8b', 'mistral:7b'];
  requiredKey: string | undefined = undefined;
  redirectTo = 'http://127.0.0.1:1/elsewhere';
  /** What a chat completion says: whole in one answer, or in these pieces as a stream. */
  deltas: string[] = ['pong'];
  /** Pause between two stream pieces; makes the stream visible in a browser. */
  streamDelayMs = 0;
  readonly requests: FakeRequest[] = [];
  readonly url: string;
  readonly port: number;
  private readonly server: Server;

  private constructor(server: Server, port: number) {
    this.server = server;
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
  }

  static async start(port = 0, host = '127.0.0.1'): Promise<FakeProvider> {
    const holder: { instance: FakeProvider | undefined } = { instance: undefined };
    const server = createServer((request, response) => {
      holder.instance?.handle(request, response);
    });
    await new Promise<void>((resolve) => {
      server.listen(port, host, resolve);
    });
    holder.instance = new FakeProvider(server, (server.address() as AddressInfo).port);
    return holder.instance;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => {
        resolve();
      });
    });
  }

  private async stream(model: string, response: ServerResponse): Promise<void> {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [index, delta] of this.deltas.entries()) {
      if (index > 0 && this.streamDelayMs > 0) await sleep(this.streamDelayMs);
      if (response.destroyed) return;
      response.write(chunk(model, { role: 'assistant', content: delta }, null));
    }
    response.write(chunk(model, {}, 'stop'));
    response.end('data: [DONE]\n\n');
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on('data', (piece: Buffer) => chunks.push(piece));
    request.on('end', () => {
      const path = (request.url ?? '/').split('?')[0] ?? '/';
      const body = Buffer.concat(chunks).toString('utf8');
      this.requests.push({
        method: request.method ?? 'GET',
        path,
        host: request.headers.host,
        authorization: request.headers.authorization,
        body,
      });
      this.answer(request.method ?? 'GET', path, request.headers.authorization, body, response);
    });
  }

  private answer(
    method: string,
    path: string,
    authorization: string | undefined,
    body: string,
    response: ServerResponse
  ): void {
    const json = (status: number, payload: string, extra: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...extra });
      response.end(payload);
    };

    if (this.mode === FAKE_MODE.HANG) return;
    if (this.mode === FAKE_MODE.REDIRECT) {
      response.writeHead(302, { location: this.redirectTo });
      response.end();
      return;
    }
    if (this.mode === FAKE_MODE.HTML) {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body>Sign in to continue</body></html>');
      return;
    }
    if (this.mode === FAKE_MODE.GARBAGE) return json(200, '{not json');
    if (this.mode === FAKE_MODE.WRONG_SHAPE) return json(200, '{"unexpected":true}');
    if (this.mode === FAKE_MODE.OVERSIZED)
      return json(200, `[${'1,'.repeat(OVERSIZED_BYTES / 2)}1]`);
    if (this.mode === FAKE_MODE.OVERSIZED_STREAM) {
      // No content-length: Node answers chunked, so only counting bytes can catch it.
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('[');
      for (let sent = 0; sent < OVERSIZED_BYTES * 2; sent += 512) response.write('1,'.repeat(256));
      response.end('1]');
      return;
    }
    if (this.mode === FAKE_MODE.SERVER_ERROR) return json(500, '{"error":"boom"}');
    if (
      this.mode === FAKE_MODE.UNAUTHORIZED ||
      (this.requiredKey !== undefined && authorization !== `Bearer ${this.requiredKey}`)
    ) {
      return json(401, '{"error":"invalid key"}');
    }

    if (method === 'GET' && path === '/api/tags') {
      const models = this.models.map((name) => ({
        name,
        model: name,
        modified_at: '2026-01-01T00:00:00Z',
        size: 1,
        digest: 'sha256:fake',
        details: { family: 'fake', parameter_size: '8B', quantization_level: 'Q4_0' },
      }));
      return json(200, JSON.stringify({ models }));
    }
    if (method === 'GET' && path === '/v1/models') {
      const data = this.models.map((id) => ({ id, object: 'model', created: 1, owned_by: 'fake' }));
      return json(200, JSON.stringify({ object: 'list', data }));
    }
    if (method === 'POST' && path === '/v1/chat/completions') {
      const parsed: unknown = JSON.parse(body);
      const requested = typeof parsed === 'object' && parsed !== null ? parsed : {};
      const model =
        'model' in requested && typeof requested.model === 'string' ? requested.model : 'fake';
      if ('stream' in requested && requested.stream === true) {
        void this.stream(model, response);
        return;
      }
      return json(200, completion(model, this.deltas.join('')));
    }
    return json(404, '{"error":"not found"}');
  }
}

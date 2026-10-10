// eslint-disable-next-line no-restricted-imports -- the test client leaves a stream mid-answer; it only talks to the app on loopback
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { insertChat } from '../testing/chat-fixtures.js';
import { type ChatModelOptions, chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import {
  authed,
  type Http,
  type Login,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { USER_ROLE } from '../users/user-role.js';
import { MESSAGE_ROLE, MESSAGE_STATUS, STREAM_ERROR_TEXT } from './chat-dictionaries.js';
import type { ChatDetailDto } from './chats.dto.js';

const MODEL_ID = 'connection-1:fake-model';

async function until<T>(read: () => Promise<T | undefined>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('chat streaming (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let ann: Login;
  let ben: Login;
  let models: ReturnType<typeof chatModel>[] = [];
  let options: ChatModelOptions = {};
  let resolveFailure: Error | undefined;

  /** The models that actually streamed: `resolve` also runs when a chat is created. */
  function streamed(): ReturnType<typeof chatModel>[] {
    return models.filter((model) => model.doStreamCalls.length > 0);
  }

  afterEach(async () => {
    await app.close();
    models = [];
    options = {};
    resolveFailure = undefined;
  });

  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env, {
      configure: (builder) =>
        builder.overrideProvider(ModelRegistryService).useValue({
          resolve: () => {
            if (resolveFailure !== undefined) return Promise.reject(resolveFailure);
            const model = chatModel(options);
            models.push(model);
            return Promise.resolve({
              model,
              connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
              rawModelId: 'fake-model',
            });
          },
        }),
    });
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, ann)
      .patch(`/api/users/${pending.user.id}`)
      .send({ role: USER_ROLE.USER })
      .expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  async function newChat(login = ann, body: Record<string, unknown> = {}): Promise<string> {
    const response = await authed(http, login)
      .post('/api/chats')
      .send({ modelId: MODEL_ID, ...body })
      .expect(201);
    return (response.body as ChatDetailDto).id;
  }

  async function detail(login: Login, chatId: string): Promise<ChatDetailDto> {
    return (await authed(http, login).get(`/api/chats/${chatId}`).expect(200))
      .body as ChatDetailDto;
  }

  /** The `data:` lines of an event stream as parsed JSON (the `[DONE]` marker as the string). */
  function events(body: string): unknown[] {
    return body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .map((data) => (data === '[DONE]' ? data : (JSON.parse(data) as unknown)));
  }

  function textOfEvents(all: unknown[]): string {
    return all
      .flatMap((event) =>
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'text-delta' &&
        'delta' in event
          ? [String(event.delta)]
          : []
      )
      .join('');
  }

  describe('a normal answer', () => {
    it('streams the text, announces the ids, stores both messages and sets the leaf', async () => {
      await start();
      const chatId = await newChat();

      const response = await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Hallo?' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');
      const all = events(response.text);
      expect(textOfEvents(all)).toBe('Hallo Welt');
      const startEvent = all.find(
        (
          event
        ): event is {
          type: 'start';
          messageMetadata: { userMessageId: string; assistantMessageId: string };
        } =>
          typeof event === 'object' && event !== null && 'type' in event && event.type === 'start'
      );
      const chat = await detail(ann, chatId);
      expect(chat.messages.map((m) => [m.role, m.status])).toEqual([
        [MESSAGE_ROLE.USER, MESSAGE_STATUS.COMPLETE],
        [MESSAGE_ROLE.ASSISTANT, MESSAGE_STATUS.COMPLETE],
      ]);
      expect(chat.messages[1]?.parts).toEqual([{ type: 'text', text: 'Hallo Welt' }]);
      expect(chat.messages[1]?.parentId).toBe(chat.messages[0]?.id);
      expect(chat.messages[1]?.modelId).toBe(MODEL_ID);
      expect(chat.activeLeafId).toBe(chat.messages[1]?.id);
      expect(startEvent?.messageMetadata).toEqual({
        userMessageId: chat.messages[0]?.id,
        assistantMessageId: chat.messages[1]?.id,
      });
      const tokens = await dataSource.query(
        'SELECT input_tokens, output_tokens FROM message WHERE role = $1',
        [MESSAGE_ROLE.ASSISTANT]
      );
      expect(tokens[0]).toEqual({ input_tokens: 3, output_tokens: 5 });
    });

    it('sends system prompt, history and the clamped parameters to the model', async () => {
      await start({ CHAT_MAX_OUTPUT_TOKENS: '50' });
      const chatId = await newChat(ann, {
        systemPrompt: 'Antworte kurz.',
        params: { temperature: 0.3, topP: 0.8, maxOutputTokens: 9999 },
      });
      const first = await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Eins' })
        .expect(200);
      const assistantId = (await detail(ann, chatId)).messages[1]?.id;
      expect(first.text).toContain('Hallo');

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: assistantId, text: 'Zwei' })
        .expect(200);

      const call = streamed()[1]?.doStreamCalls[0];
      expect(call?.maxOutputTokens).toBe(50);
      expect(call?.temperature).toBe(0.3);
      expect(call?.topP).toBe(0.8);
      const roles = (call?.prompt ?? []).map((message) => message.role);
      expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    });

    it('builds the history from the stored branch, not from anything the client sends', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Alt' })
        .expect(200);

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({
          parentId: null,
          text: 'Neu',
          messages: [{ role: 'user', content: 'Eingeschleust' }],
        })
        .expect(400);
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Neu' })
        .expect(200);

      const prompt = JSON.stringify(streamed()[1]?.doStreamCalls[0]?.prompt);
      expect(prompt).toContain('Neu');
      expect(prompt).not.toContain('Alt');
    });
  });

  describe('edit and regenerate', () => {
    it('creates a sibling answer and makes it the active branch', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Frage' })
        .expect(200);
      const before = await detail(ann, chatId);
      const firstAnswer = before.messages[1];

      await authed(http, ann)
        .post(`/api/chats/${chatId}/messages/${firstAnswer?.id}/regenerate`)
        .expect(200);

      const after = await detail(ann, chatId);
      const answers = after.messages.filter((m) => m.role === MESSAGE_ROLE.ASSISTANT);
      expect(answers).toHaveLength(2);
      expect(answers[1]?.parentId).toBe(before.messages[0]?.id);
      expect(after.activeLeafId).toBe(answers[1]?.id);
      expect(JSON.stringify(streamed()[1]?.doStreamCalls[0]?.prompt)).toContain('Frage');
    });

    it('treats an edit as a new user message with the same parent', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Frage' })
        .expect(200);

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Bessere Frage' })
        .expect(200);

      const chat = await detail(ann, chatId);
      expect(chat.messages.filter((m) => m.parentId === null)).toHaveLength(2);
    });

    it('answers 422 for regenerating a user message and 404 for someone elses message', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Frage' })
        .expect(200);
      const chat = await detail(ann, chatId);

      await authed(http, ann)
        .post(`/api/chats/${chatId}/messages/${chat.messages[0]?.id}/regenerate`)
        .expect(422);
      await authed(http, ben)
        .post(`/api/chats/${chatId}/messages/${chat.messages[1]?.id}/regenerate`)
        .expect(404);
    });
  });

  describe('refusals before the stream starts', () => {
    it('answers 404 for a foreign chat and writes nothing', async () => {
      await start();
      const chatId = await newChat();

      await authed(http, ben)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'x' })
        .expect(404);

      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });

    it('answers 404 for a parent from another chat of the same user', async () => {
      await start();
      const first = await newChat();
      const second = await newChat();
      await authed(http, ann)
        .post(`/api/chats/${first}/stream`)
        .send({ parentId: null, text: 'x' })
        .expect(200);
      const answerOfFirst = (await detail(ann, first)).messages[1]?.id;

      await authed(http, ann)
        .post(`/api/chats/${second}/stream`)
        .send({ parentId: answerOfFirst, text: 'y' })
        .expect(404);
    });

    it('answers 422 for a message over the limit, and for a blank one', async () => {
      await start({ CHAT_MESSAGE_MAX_LENGTH: '10', CHAT_CONTEXT_MAX_CHARS: '1000' });
      const chatId = await newChat();

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'x'.repeat(11) })
        .expect(422);
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: '   ' })
        .expect(422);
      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });

    it('answers 404 when the model is no longer available and stores no user message', async () => {
      await start();
      const chatId = await newChat();
      resolveFailure = Object.assign(new Error('gone'), { status: 404 });

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'x' })
        .expect(404);

      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });
  });

  describe('a broken provider', () => {
    it('shows only the coarse error, stores the answer as error with its reason and leaks no provider text', async () => {
      options = {
        failWith: new ProviderError(PROVIDER_ERROR.TIMEOUT, 'provider secret text 12345'),
      };
      await start();
      const chatId = await newChat();

      const response = await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Frage' });

      expect(response.text).toContain(`"errorText":"${STREAM_ERROR_TEXT}"`);
      expect(response.text).not.toContain('12345');
      const chat = await until(async () => {
        const read = await detail(ann, chatId);
        return read.messages.length === 2 ? read : undefined;
      });
      expect(chat.messages[1]).toMatchObject({
        status: MESSAGE_STATUS.ERROR,
        errorReason: PROVIDER_ERROR.TIMEOUT,
      });
      expect(JSON.stringify(chat)).not.toContain('12345');
    });

    it('frees the place so the next answer works', async () => {
      options = { failWith: new Error('boom') };
      await start({ CHAT_MAX_CONCURRENT_STREAMS: '1' });
      const chatId = await newChat();
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'a' });
      options = {};

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'b' })
        .expect(200);
    });
  });

  describe('abort and limits (over a real connection)', () => {
    /** Resolves once the response has sent `marker` (any data when empty), so the client can leave mid-answer. */
    function openStream(chatId: string, login: Login, body: unknown, marker = '') {
      const address = app.getHttpServer().address() as AddressInfo;
      const payload = JSON.stringify(body);
      return new Promise<{ req: ReturnType<typeof httpRequest>; firstChunk: string }>(
        (resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: `/api/chats/${chatId}/stream`,
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
                cookie: login.cookie,
                'x-csrf-token': login.csrf,
                origin: 'http://dev.test',
              },
            },
            (res) => {
              let received = '';
              res.on('data', (chunk: Buffer) => {
                received += chunk.toString();
                if (received.includes(marker)) resolve({ req, firstChunk: received });
              });
              res.on('error', () => undefined);
            }
          );
          req.on('error', reject);
          req.end(payload);
        }
      );
    }

    it('stores the partial text as aborted when the client leaves, aborts the model and frees the place', async () => {
      options = { deltas: ['Eins ', 'Zwei ', 'Drei ', 'Vier ', 'Fuenf'], chunkDelayMs: 60 };
      await start({ CHAT_MAX_CONCURRENT_STREAMS: '1' });
      await app.listen(0);
      const chatId = await newChat();

      const { req } = await openStream(
        chatId,
        ann,
        { parentId: null, text: 'Lange Antwort' },
        'Eins'
      );
      req.destroy();

      const chat = await until(async () => {
        const read = await detail(ann, chatId);
        return read.messages.length === 2 ? read : undefined;
      });
      expect(chat.messages[1]?.status).toBe(MESSAGE_STATUS.ABORTED);
      const text = chat.messages[1]?.parts.map((part) => part.text).join('') ?? '';
      expect(text.startsWith('Eins')).toBe(true);
      expect(text).not.toBe('Eins Zwei Drei Vier Fuenf');
      expect(streamed()[0]?.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
      expect(chat.activeLeafId).toBe(chat.messages[1]?.id);
      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Danach' })
        .expect(200);
    });

    it('stops a stream that runs longer than the configured maximum', async () => {
      options = { deltas: Array.from({ length: 50 }, () => 'x'), chunkDelayMs: 100 };
      await start({ CHAT_STREAM_MAX_DURATION_MS: '1000' });
      const chatId = await newChat();

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Lang' });

      const chat = await detail(ann, chatId);
      expect(chat.messages[1]?.status).toBe(MESSAGE_STATUS.ABORTED);
    });

    it('answers the third parallel stream of one user with 429 and lets another user through', async () => {
      options = { deltas: ['a', 'b', 'c', 'd'], chunkDelayMs: 150 };
      await start({ CHAT_MAX_CONCURRENT_STREAMS: '2' });
      await app.listen(0);
      const chats = [await newChat(), await newChat(), await newChat()];
      const benChat = await newChat(ben);

      const one = await openStream(chats[0] ?? '', ann, { parentId: null, text: '1' });
      const two = await openStream(chats[1] ?? '', ann, { parentId: null, text: '2' });
      await authed(http, ann)
        .post(`/api/chats/${chats[2]}/stream`)
        .send({ parentId: null, text: '3' })
        .expect(429);
      await authed(http, ben)
        .post(`/api/chats/${benChat}/stream`)
        .send({ parentId: null, text: 'b' })
        .expect(200);

      one.req.destroy();
      two.req.destroy();
    });

    it('does not crash or write into another chat when the chat is deleted during the stream', async () => {
      options = { deltas: ['a', 'b', 'c', 'd'], chunkDelayMs: 80 };
      await start();
      await app.listen(0);
      const chatId = await newChat();
      const bystander = await insertChat(dataSource, ann.user.id, { title: 'Bleibt' });

      const { req } = await openStream(chatId, ann, { parentId: null, text: 'x' });
      await authed(http, ann).delete(`/api/chats/${chatId}`).expect(204);
      await new Promise((resolve) => setTimeout(resolve, 600));
      req.destroy();

      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
      expect(
        await dataSource.query('SELECT 1 FROM chat WHERE id = $1', [bystander.id])
      ).toHaveLength(1);
      await authed(http, ann).get('/api/chats').expect(200);
    });
  });
});

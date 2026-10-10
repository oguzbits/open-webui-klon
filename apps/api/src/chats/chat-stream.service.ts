import { randomUUID } from 'node:crypto';

import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../config/env.js';
import { CollectionsService } from '../knowledge/collections.service.js';
import { buildKnowledgeContext, verifyCitations } from '../knowledge/knowledge-context.js';
import { KnowledgeSearchService } from '../knowledge/knowledge-search.service.js';
import { ProviderError } from '../http/safe-fetch/provider-error.js';
import { ModelRegistryService, type ResolvedModel } from '../models/model-registry.service.js';
import {
  MESSAGE_ERROR_REASON,
  MESSAGE_STATUS,
  type MessageStatus,
  STREAM_ERROR_TEXT,
} from './chat-dictionaries.js';
import { buildHistory } from './chat-history.js';
import type { MessagePart, MessageSource } from './chat-params.js';
import { ChatTitleService } from './chat-title.service.js';
import type { Chat } from './chat.entity.js';
import type { StreamChatDto } from './chats.dto.js';
import { ChatsService } from './chats.service.js';
import { MessageTreeService } from './message-tree.service.js';
import { StreamSlots } from './stream-slots.js';

interface Run {
  userId: string;
  chat: Chat;
  resolved: ResolvedModel;
  /** The user message the answer hangs under; the history ends here. */
  userMessageId: string;
  /** Set when the chat searched its collections for this answer. */
  knowledge: { prompt: string; sources: MessageSource[] } | undefined;
}

/** Looks through the `cause` chain for a provider error; everything else is "internal". */
function reasonOf(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof ProviderError) return current.reason;
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return MESSAGE_ERROR_REASON.INTERNAL;
}

function statusOf(outcome: { status: string }, isAborted: boolean): MessageStatus {
  if (isAborted) return MESSAGE_STATUS.ABORTED;
  if (outcome.status === 'completed') return MESSAGE_STATUS.COMPLETE;
  if (outcome.status === 'failed') return MESSAGE_STATUS.ERROR;
  return MESSAGE_STATUS.ABORTED;
}

/**
 * The client's copy of the stream: when the source throws, the client gets one error part and a clean end instead of
 * a cut connection. The failure itself is handled (stored, logged) on the other branch.
 */
function withErrorPart<T>(stream: ReadableStream<T>, errorPart: T): ReadableStream<T> {
  const reader = stream.getReader();
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch {
        controller.enqueue(errorPart);
        controller.close();
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

@Injectable()
export class ChatStreamService {
  private readonly messageMax: number;
  private readonly contextMax: number;
  private readonly outputMax: number;
  private readonly durationMs: number;
  private readonly contextCharsMax: number;

  constructor(
    private readonly chats: ChatsService,
    private readonly tree: MessageTreeService,
    private readonly registry: ModelRegistryService,
    private readonly slots: StreamSlots,
    private readonly titles: ChatTitleService,
    private readonly collections: CollectionsService,
    private readonly search: KnowledgeSearchService,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>
  ) {
    this.logger.setContext(ChatStreamService.name);
    this.messageMax = config.get('CHAT_MESSAGE_MAX_LENGTH', { infer: true });
    this.contextMax = config.get('CHAT_CONTEXT_MAX_CHARS', { infer: true });
    this.outputMax = config.get('CHAT_MAX_OUTPUT_TOKENS', { infer: true });
    this.durationMs = config.get('CHAT_STREAM_MAX_DURATION_MS', { infer: true });
    this.contextCharsMax = config.get('RAG_CONTEXT_MAX_CHARS', { infer: true });
  }

  /** New user message under `input.parentId`, then the answer as an event stream. */
  async stream(
    userId: string,
    chatId: string,
    input: StreamChatDto,
    response: Response
  ): Promise<void> {
    const text = input.text.trim();
    if (text === '' || input.text.length > this.messageMax || text.length > this.contextMax) {
      throw new UnprocessableEntityException('The message is empty or too long');
    }
    const release = this.slots.acquire(userId);
    try {
      const chat = await this.chats.getOwned(userId, chatId);
      const resolved = await this.registry.resolve(chat.modelId);
      // The search comes first: if it fails (503), the question has not been stored.
      const knowledge = await this.searchCollections(userId, chat, text);
      const { messageId } = await this.tree.appendUserMessage(
        userId,
        chatId,
        input.parentId,
        input.text
      );
      await this.run({ userId, chat, resolved, userMessageId: messageId, knowledge }, response);
    } finally {
      release();
    }
  }

  /** A new answer next to `messageId`, to the same user message. */
  async regenerate(
    userId: string,
    chatId: string,
    messageId: string,
    response: Response
  ): Promise<void> {
    const release = this.slots.acquire(userId);
    try {
      const chat = await this.chats.getOwned(userId, chatId);
      const resolved = await this.registry.resolve(chat.modelId);
      // prepareRegenerate only checks and reads; nothing is written before the search has succeeded.
      const { userMessageId, userText } = await this.tree.prepareRegenerate(
        userId,
        chatId,
        messageId
      );
      const knowledge = await this.searchCollections(userId, chat, userText);
      await this.run({ userId, chat, resolved, userMessageId, knowledge }, response);
    } finally {
      release();
    }
  }

  /** Undefined when the chat has no (remaining) collection: no embedding call, the prompt stays as it is. */
  private async searchCollections(
    userId: string,
    chat: Chat,
    question: string
  ): Promise<Run['knowledge']> {
    const collectionIds = await this.collections.ownedIds(userId, chat.collectionIds);
    if (collectionIds.length === 0) return undefined;
    const startedAt = Date.now();
    const hits = await this.search.search(userId, collectionIds, question);
    const context = buildKnowledgeContext(hits, this.contextCharsMax);
    this.logger.info({
      chatId: chat.id,
      hits: hits.length,
      sources: context.sources.length,
      durationMs: Date.now() - startedAt,
    });
    return context;
  }

  private async run(run: Run, response: Response): Promise<void> {
    const { userId, chat, resolved, userMessageId, knowledge } = run;
    const startedAt = Date.now();
    const assistantMessageId = randomUUID();

    // Before the first await: a client that leaves while the history loads must still abort the model call.
    const abort = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) abort.abort();
    });
    if (response.destroyed && !response.writableFinished) abort.abort();

    const path = await this.tree.loadPath(userId, chat.id, userMessageId);
    const history = buildHistory(path, this.contextMax);
    const messages = await convertToModelMessages(
      history.map((message): Omit<UIMessage, 'id'> => ({
        role: message.role,
        parts: message.parts,
      }))
    );

    const abortSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(this.durationMs)]);

    const result = streamText({
      model: resolved.model,
      // The excerpts come after the chat's own prompt, never before it.
      system:
        [chat.systemPrompt, knowledge?.prompt]
          .filter((part): part is string => part !== null && part !== undefined && part !== '')
          .join('\n\n') || undefined,
      messages,
      abortSignal,
      maxRetries: 0,
      maxOutputTokens: Math.min(chat.params.maxOutputTokens ?? this.outputMax, this.outputMax),
      temperature: chat.params.temperature,
      topP: chat.params.topP,
    });

    const ui = toUIMessageStream({
      stream: result.stream,
      onError: () => STREAM_ERROR_TEXT,
      messageMetadata: ({ part }) =>
        part.type === 'start'
          ? { userMessageId, assistantMessageId, sources: knowledge?.sources }
          : undefined,
      onEnd: async (event) => {
        const status = statusOf(event.outcome, event.isAborted);
        const raw = event.responseMessage.parts
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('');
        // Only numbers that were sent to the model stay citations.
        const joined =
          knowledge === undefined ? raw : verifyCitations(raw, knowledge.sources.length);
        const parts: MessagePart[] = joined === '' ? [] : [{ type: 'text', text: joined }];
        const usage = status === MESSAGE_STATUS.COMPLETE ? await result.usage : undefined;
        const saved = await this.tree.saveAssistant({
          userId,
          chatId: chat.id,
          id: assistantMessageId,
          parentId: userMessageId,
          status,
          parts,
          sources: knowledge?.sources ?? null,
          errorReason:
            status === MESSAGE_STATUS.ERROR
              ? reasonOf(event.outcome.status === 'failed' ? event.outcome.error : undefined)
              : null,
          modelId: chat.modelId,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
        });
        this.logger.info({
          chatId: chat.id,
          messageId: assistantMessageId,
          status,
          saved,
          outputChars: joined.length,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          durationMs: Date.now() - startedAt,
        });
        if (saved && status === MESSAGE_STATUS.COMPLETE) {
          await this.titles.scheduleAfterAnswer(chat.id);
        }
      },
    });

    // One branch goes to the client, the other is read to the end so the answer is stored even if the client left.
    const [toClient, toDrain] = ui.tee();
    const [sent, drained] = await Promise.allSettled([
      pipeUIMessageStreamToResponse({
        response,
        stream: withErrorPart(toClient, { type: 'error', errorText: STREAM_ERROR_TEXT }),
      }),
      drain(toDrain),
    ]);

    if (drained.status === 'rejected') {
      this.logger.warn({
        chatId: chat.id,
        messageId: assistantMessageId,
        errorName: drained.reason instanceof Error ? drained.reason.name : 'unknown',
        durationMs: Date.now() - startedAt,
      });
    } else if (sent.status === 'rejected') {
      this.logger.debug(
        { chatId: chat.id, messageId: assistantMessageId },
        'client left the stream'
      );
    }
  }
}

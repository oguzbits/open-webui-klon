import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { generateText } from 'ai';
import { PinoLogger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';

import { JOB_QUEUE, type JobQueue } from '../jobs/job-queue.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { textOf } from './chat-history.js';
import { CHAT_JOB, CHAT_TITLE_SOURCE, MESSAGE_ROLE, MESSAGE_STATUS } from './chat-dictionaries.js';
import type { MessagePart } from './chat-params.js';
import { sanitizeTitle } from './chat-title.js';
import { MessageTreeService } from './message-tree.service.js';

const TITLE_INSTRUCTION =
  'Schreibe einen kurzen Titel (höchstens 6 Wörter) für diese Unterhaltung, in der Sprache der Nutzerfrage. Antworte nur mit dem Titel, ohne Anführungszeichen.';
const EXCERPT_CHARS = 1000;
const TITLE_TIMEOUT_MS = 30_000;
const TITLE_MAX_OUTPUT_TOKENS = 30;

interface FirstTurn {
  model_id: string;
  question: MessagePart[];
  answer: MessagePart[];
}

/**
 * The title of a chat. The first completed answer queues a job that carries only the chat id; the worker asks the
 * chat's own model for a title. If that fails after the retries, the title stays the start of the first message
 * (`titleSource = fallback`), which the product treats as a normal, visible default.
 */
@Injectable()
export class ChatTitleService implements OnApplicationBootstrap {
  constructor(
    @InjectDataSource() private readonly dataSource: Pick<DataSource, 'query'>,
    // Narrow types keep the unit test's fakes honest; the explicit tokens are needed because a Pick has no runtime type.
    @Inject(MessageTreeService)
    private readonly tree: Pick<MessageTreeService, 'countCompletedAnswers'>,
    @Inject(ModelRegistryService) private readonly registry: Pick<ModelRegistryService, 'resolve'>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ChatTitleService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(CHAT_JOB.GENERATE_TITLE, (data) => this.generate(data.chatId));
  }

  /**
   * Called after an answer was stored. Best effort: if queueing fails the chat keeps its fallback title and the
   * error is logged (the answer is already saved and must not turn into an error for the user).
   */
  async scheduleAfterAnswer(chatId: string): Promise<void> {
    try {
      const rows: { title_source: string }[] = await this.dataSource.query(
        'SELECT title_source FROM chat WHERE id = $1',
        [chatId]
      );
      if (rows[0]?.title_source !== CHAT_TITLE_SOURCE.FALLBACK) return;
      if ((await this.tree.countCompletedAnswers(chatId)) !== 1) return;
      await this.queue.send(CHAT_JOB.GENERATE_TITLE, { chatId });
    } catch (error) {
      this.logger.error({
        chatId,
        errorName: error instanceof Error ? error.name : 'unknown',
        msg: 'could not queue the title job',
      });
    }
  }

  /** The job. Throws when no usable title comes out, so the queue retries. */
  async generate(chatId: string): Promise<void> {
    const rows: FirstTurn[] = await this.dataSource.query(
      `SELECT c.model_id, q.parts AS question, a.parts AS answer
         FROM chat c
         JOIN message q ON q.chat_id = c.id AND q.role = $2
         JOIN message a ON a.parent_id = q.id AND a.role = $3 AND a.status = $4
        WHERE c.id = $1 AND c.title_source = $5
        ORDER BY q.created_at, a.created_at
        LIMIT 1`,
      [
        chatId,
        MESSAGE_ROLE.USER,
        MESSAGE_ROLE.ASSISTANT,
        MESSAGE_STATUS.COMPLETE,
        CHAT_TITLE_SOURCE.FALLBACK,
      ]
    );
    const turn = rows[0];
    if (turn === undefined) return;

    const { model } = await this.registry.resolve(turn.model_id);
    const result = await generateText({
      model,
      system: TITLE_INSTRUCTION,
      prompt: `Frage: ${textOf(turn.question).slice(0, EXCERPT_CHARS)}\n\nAntwort: ${textOf(turn.answer).slice(0, EXCERPT_CHARS)}`,
      maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    });
    const title = sanitizeTitle(result.text);
    if (title === '') throw new Error('The model returned no usable title');

    // No updated_at bump: the chat list must not reorder when the job finishes. The guard keeps a title the
    // user chose while the model was thinking.
    const updated: [unknown[], number] = await this.dataSource.query(
      `UPDATE chat SET title = $2, title_source = $3
        WHERE id = $1 AND title_source = $4`,
      [chatId, title, CHAT_TITLE_SOURCE.GENERATED, CHAT_TITLE_SOURCE.FALLBACK]
    );
    this.logger.info({ chatId, titleChars: title.length, applied: updated[1] > 0 });
  }
}

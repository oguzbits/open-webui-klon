import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from '../../app.module.js';
import type { Env } from '../../config/env.js';
import { CollectionsService } from '../../knowledge/collections.service.js';
import { DocumentsService } from '../../knowledge/documents.service.js';
import { KnowledgeSearchService } from '../../knowledge/knowledge-search.service.js';
import { DOCUMENT_STATUS } from '../../knowledge/rag-dictionaries.js';
import { USER_ROLE } from '../../users/user-role.js';
import { User } from '../../users/user.entity.js';
import { type Expectation, rankOf, summarize } from './metrics.js';

const DATA_DIR = resolve(import.meta.dirname, '../../../eval/rag');
const READY_TIMEOUT_MS = 180_000;
const POLL_MS = 1000;

interface Question extends Expectation {
  question: string;
}

function parseQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) throw new Error('questions.json must be a list');
  return raw.map((entry: unknown): Question => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('question' in entry) ||
      !('expect' in entry) ||
      typeof entry.question !== 'string' ||
      typeof entry.expect !== 'string'
    ) {
      throw new Error('Every entry of questions.json needs "question" and "expect"');
    }
    const page = 'page' in entry && typeof entry.page === 'number' ? entry.page : undefined;
    return { question: entry.question, filename: entry.expect, page };
  });
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)} %`;
}

async function run(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dataSource = app.get(DataSource);
  const users = dataSource.getRepository(User);
  const user = await users.save(
    users.create({
      email: `eval-${randomUUID()}@example.invalid`,
      name: 'RAG eval',
      passwordHash: 'not-a-real-hash',
      role: USER_ROLE.USER,
      disabledAt: null,
    })
  );
  try {
    const topK = app.get<ConfigService<Env, true>>(ConfigService).get('RAG_TOP_K', { infer: true });
    const collection = await app.get(CollectionsService).create(user.id, 'RAG eval');
    const documents = app.get(DocumentsService);
    const fixtures = resolve(DATA_DIR, 'fixtures');
    for (const name of readdirSync(fixtures)) {
      const buffer = readFileSync(resolve(fixtures, name));
      await documents.upload(user.id, { originalname: name, buffer }, collection.id);
    }

    const deadline = Date.now() + READY_TIMEOUT_MS;
    let states: { status: string; failure_reason: string | null; filename: string }[] = [];
    for (;;) {
      states = await dataSource.query(
        'SELECT status, failure_reason, filename FROM document WHERE user_id = $1',
        [user.id]
      );
      const open = states.some(
        (row) => row.status === DOCUMENT_STATUS.PENDING || row.status === DOCUMENT_STATUS.PROCESSING
      );
      if (!open) break;
      if (Date.now() > deadline) throw new Error('Documents were not ready in time');
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
    const failed = states.filter((row) => row.status === DOCUMENT_STATUS.FAILED);
    for (const row of failed) print(`FAILED ${row.filename}: ${row.failure_reason ?? 'unknown'}`);

    const search = app.get(KnowledgeSearchService);
    const questions = parseQuestions(
      JSON.parse(readFileSync(resolve(DATA_DIR, 'questions.json'), 'utf8')) as unknown
    );
    const ranks: (number | undefined)[] = [];
    for (const item of questions) {
      const hits = await search.search(user.id, [collection.id], item.question);
      const rank = rankOf(hits, item);
      ranks.push(rank);
      print(`${rank === undefined ? ' -' : String(rank).padStart(2)}  ${item.question}`);
    }
    const summary = summarize(ranks, topK);
    print('');
    print(`questions ${summary.questions}  documents ${states.length}  failed ${failed.length}`);
    print(
      `hit@1 ${percent(summary.hitAt1)}  hit@${topK} ${percent(summary.hitAtK)}  MRR ${summary.mrr.toFixed(3)}`
    );
    return failed.length > 0 ? 1 : 0;
  } finally {
    try {
      const owned: { id: string }[] = await dataSource.query(
        'SELECT id FROM document WHERE user_id = $1',
        [user.id]
      );
      for (const row of owned) await app.get(DocumentsService).remove(user.id, row.id);
    } finally {
      // The user goes in any case; collections and chunks go with it.
      await dataSource.query('DELETE FROM app_user WHERE id = $1', [user.id]);
      await app.close();
    }
  }
}

run().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`eval failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exit(1);
  }
);

import { describe, expect, it } from 'vitest';

import { FakeJobQueue } from '../testing/fake-job-queue.js';
import { silentLogger } from '../testing/provider-fixtures.js';
import { CHAT_JOB } from '../jobs/job-names.js';
import { CHAT_TITLE_SOURCE, type ChatTitleSource } from './chat-dictionaries.js';
import { ChatTitleService } from './chat-title.service.js';

function service(options: { answers: number; titleSource?: ChatTitleSource }) {
  const queue = new FakeJobQueue();
  const titles = new ChatTitleService(
    {
      query: <T>(): Promise<T> =>
        Promise.resolve([{ title_source: options.titleSource ?? CHAT_TITLE_SOURCE.FALLBACK }] as T),
    },
    { countCompletedAnswers: () => Promise.resolve(options.answers) },
    { resolve: () => Promise.reject(new Error('not used when scheduling')) },
    queue,
    silentLogger()
  );
  return { titles, queue };
}

describe('scheduleAfterAnswer', () => {
  it('queues exactly one job, with the chat id only, after the first completed answer', async () => {
    const { titles, queue } = service({ answers: 1 });

    await titles.scheduleAfterAnswer('chat-1');

    expect(queue.sent).toEqual([{ name: CHAT_JOB.GENERATE_TITLE, data: { chatId: 'chat-1' } }]);
  });

  it('queues nothing after later answers or when the user named the chat', async () => {
    const later = service({ answers: 2 });
    const named = service({ answers: 1, titleSource: CHAT_TITLE_SOURCE.USER });

    await later.titles.scheduleAfterAnswer('chat-1');
    await named.titles.scheduleAfterAnswer('chat-1');

    expect(later.queue.sent).toEqual([]);
    expect(named.queue.sent).toEqual([]);
  });
});

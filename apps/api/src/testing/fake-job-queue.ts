import type { ChatJobData, JobQueue } from '../jobs/job-queue.js';

/** In memory: jobs wait until a test calls `run`. */
export class FakeJobQueue implements JobQueue {
  readonly sent: { name: string; data: ChatJobData }[] = [];
  private readonly handlers = new Map<string, (data: ChatJobData) => Promise<void>>();

  send(name: string, data: ChatJobData): Promise<void> {
    this.sent.push({ name, data });
    return Promise.resolve();
  }

  work(name: string, handler: (data: ChatJobData) => Promise<void>): Promise<void> {
    this.handlers.set(name, handler);
    return Promise.resolve();
  }

  /** Runs every job sent under `name` once, in order; the first error is thrown. */
  async run(name: string): Promise<void> {
    const handler = this.handlers.get(name);
    if (handler === undefined) throw new Error(`No worker registered for ${name}`);
    for (const job of this.sent.filter((entry) => entry.name === name)) await handler(job.data);
  }
}

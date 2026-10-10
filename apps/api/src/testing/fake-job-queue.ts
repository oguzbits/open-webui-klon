import type { JobName, JobPayload } from '../jobs/job-names.js';
import type { JobAttempt, JobQueue } from '../jobs/job-queue.js';

type AnyHandler = (data: JobPayload[JobName], attempt: JobAttempt) => Promise<void>;

/** The first of three tries, like a job the real queue starts with its default retry limit. */
export const FIRST_ATTEMPT: JobAttempt = { retryCount: 0, retryLimit: 2 };
export const LAST_ATTEMPT: JobAttempt = { retryCount: 2, retryLimit: 2 };

/** In memory: jobs wait until a test calls `run`. */
export class FakeJobQueue implements JobQueue {
  readonly sent: { name: JobName; data: JobPayload[JobName] }[] = [];
  private readonly handlers = new Map<JobName, AnyHandler>();

  send<N extends JobName>(name: N, data: JobPayload[N]): Promise<void> {
    this.sent.push({ name, data });
    return Promise.resolve();
  }

  work<N extends JobName>(
    name: N,
    handler: (data: JobPayload[N], attempt: JobAttempt) => Promise<void>
  ): Promise<void> {
    // The map is keyed by name, so the handler of `name` only ever sees the payload of `name`.
    this.handlers.set(name, handler as AnyHandler);
    return Promise.resolve();
  }

  /** Runs every job sent under `name` once, in order, as the given try; the first error is thrown. */
  async run(name: JobName, attempt: JobAttempt = FIRST_ATTEMPT): Promise<void> {
    const handler = this.handlers.get(name);
    if (handler === undefined) throw new Error(`No worker registered for ${name}`);
    for (const job of this.sent.filter((entry) => entry.name === name)) {
      await handler(job.data, attempt);
    }
  }
}

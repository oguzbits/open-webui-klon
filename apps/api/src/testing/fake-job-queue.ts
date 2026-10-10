import type { JobName, JobPayload } from '../jobs/job-names.js';
import type { JobQueue } from '../jobs/job-queue.js';

type AnyHandler = (data: JobPayload[JobName]) => Promise<void>;

/** In memory: jobs wait until a test calls `run`. */
export class FakeJobQueue implements JobQueue {
  readonly sent: { name: JobName; data: JobPayload[JobName] }[] = [];
  private readonly handlers = new Map<JobName, AnyHandler>();

  send<N extends JobName>(name: N, data: JobPayload[N]): Promise<void> {
    this.sent.push({ name, data });
    return Promise.resolve();
  }

  work<N extends JobName>(name: N, handler: (data: JobPayload[N]) => Promise<void>): Promise<void> {
    // The map is keyed by name, so the handler of `name` only ever sees the payload of `name`.
    this.handlers.set(name, handler as AnyHandler);
    return Promise.resolve();
  }

  /** Runs every job sent under `name` once, in order; the first error is thrown. */
  async run(name: JobName): Promise<void> {
    const handler = this.handlers.get(name);
    if (handler === undefined) throw new Error(`No worker registered for ${name}`);
    for (const job of this.sent.filter((entry) => entry.name === name)) await handler(job.data);
  }
}

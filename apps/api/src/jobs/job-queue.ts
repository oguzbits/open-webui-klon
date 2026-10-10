import type { JobName, JobPayload } from './job-names.js';

export const JOB_QUEUE = Symbol('JOB_QUEUE');

/** The background job queue; pg-boss in production. Job data are ids only: no content in the job table. */
export interface JobQueue {
  send<N extends JobName>(name: N, data: JobPayload[N]): Promise<void>;
  /** Registers the handler for `name`. A thrown error fails the job (the queue retries it). */
  work<N extends JobName>(name: N, handler: (data: JobPayload[N]) => Promise<void>): Promise<void>;
}

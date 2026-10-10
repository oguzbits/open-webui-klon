import type { JobName, JobPayload } from './job-names.js';

export const JOB_QUEUE = Symbol('JOB_QUEUE');

/** Which try of a job a handler is running: the last one is `retryCount >= retryLimit`. */
export interface JobAttempt {
  retryCount: number;
  retryLimit: number;
}

/** The background job queue; pg-boss in production. Job data are ids only: no content in the job table. */
export interface JobQueue {
  send<N extends JobName>(name: N, data: JobPayload[N]): Promise<void>;
  /** Registers the handler for `name`. A thrown error fails the job (the queue retries it). */
  work<N extends JobName>(
    name: N,
    handler: (data: JobPayload[N], attempt: JobAttempt) => Promise<void>
  ): Promise<void>;
  /** True while a job of `name` whose data contain `data` is waiting, delayed for a retry, or running. */
  hasLiveJob<N extends JobName>(name: N, data: Partial<JobPayload[N]>): Promise<boolean>;
}

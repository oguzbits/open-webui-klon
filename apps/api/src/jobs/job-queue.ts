export const JOB_QUEUE = Symbol('JOB_QUEUE');

export interface ChatJobData {
  chatId: string;
}

/** The background job queue; pg-boss in production. Job data are ids only: no content in the job table. */
export interface JobQueue {
  send(name: string, data: ChatJobData): Promise<void>;
  /** Registers the handler for `name`. A thrown error fails the job (the queue retries it). */
  work(name: string, handler: (data: ChatJobData) => Promise<void>): Promise<void>;
}

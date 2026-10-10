export const CHAT_JOB = { GENERATE_TITLE: 'chat.generate-title' } as const;
export const RAG_JOB = { INGEST_DOCUMENT: 'rag.ingest-document' } as const;

/** What each job carries: ids only, never names or content. */
export interface JobPayload {
  [CHAT_JOB.GENERATE_TITLE]: { chatId: string };
  [RAG_JOB.INGEST_DOCUMENT]: { documentId: string };
}

export type JobName = keyof JobPayload;

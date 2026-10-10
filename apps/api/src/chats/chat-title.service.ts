import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatTitleService {
  // Interim version: the job-backed one replaces it in the title-job task.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  scheduleAfterAnswer(_chatId: string): Promise<void> {
    return Promise.resolve();
  }
}

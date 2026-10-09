import type { NestExpressApplication } from '@nestjs/platform-express';

export const API_PREFIX = 'api';

/** HTTP-level setup shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

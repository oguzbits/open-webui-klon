import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { API_PREFIX } from '../app.factory.js';
import { AppModule } from '../app.module.js';
import { buildOpenApiDocument } from './build-document.js';

const OUTPUT = resolve(import.meta.dirname, '../../openapi.json');

async function generate(): Promise<void> {
  // preview: the module graph is scanned but no provider is created, so no database connection opens.
  const app = await NestFactory.create(AppModule, {
    preview: true,
    abortOnError: false,
    logger: false,
  });
  app.setGlobalPrefix(API_PREFIX);
  const document = buildOpenApiDocument(app);
  writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

generate().catch((error: unknown) => {
  process.stderr.write(
    `openapi generation failed: ${error instanceof Error ? error.message : 'unknown'}\n`
  );
  process.exit(1);
});

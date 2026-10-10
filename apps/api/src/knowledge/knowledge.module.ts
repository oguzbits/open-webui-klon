import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

import type { Env } from '../config/env.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { ModelsModule } from '../models/models.module.js';
import { CollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { EmbeddingService } from './embedding.service.js';
import { FileStorageModule } from './file-storage.module.js';
import { IngestionService } from './ingestion.service.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import { ParserService } from './parser.service.js';

/** Fields of the upload form besides the file: only `collectionId`, so a handful of small ones is a ceiling. */
const MAX_FORM_FIELDS = 4;
const MAX_FIELD_BYTES = 1024;

@Module({
  imports: [
    FileStorageModule,
    ModelsModule,
    JobsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // No `storage` or `dest`: multer then keeps the file in memory, which is what the parser worker is fed from.
        limits: {
          fileSize: config.get('RAG_UPLOAD_MAX_BYTES', { infer: true }),
          files: 1,
          fields: MAX_FORM_FIELDS,
          fieldSize: MAX_FIELD_BYTES,
        },
      }),
    }),
  ],
  controllers: [CollectionsController, DocumentsController],
  providers: [
    CollectionsService,
    DocumentsService,
    EmbeddingService,
    ParserService,
    IngestionService,
    KnowledgeSearchService,
  ],
  exports: [CollectionsService, EmbeddingService, KnowledgeSearchService, FileStorageModule],
})
export class KnowledgeModule {}

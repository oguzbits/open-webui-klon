import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { FILE_STORAGE } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';

/** Only the file store, so a module that must remove files (users) does not pull in the knowledge controllers. */
@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LocalFileStorage(config.get('FILE_STORAGE_PATH', { infer: true })),
    },
  ],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}

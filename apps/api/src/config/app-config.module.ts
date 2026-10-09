import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadEnv, validateEnv } from './env.js';

export interface AppConfigOptions {
  /** Configuration to validate instead of process.env (tests). */
  raw?: Record<string, unknown>;
  ignoreEnvFile?: boolean;
}

@Module({})
export class AppConfigModule {
  static forRoot(options: AppConfigOptions = {}): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          // Never fall back to raw process.env text: a value the validation turned into undefined (an empty
          // variable) must stay undefined.
          skipProcessEnv: true,
          ignoreEnvFile: options.ignoreEnvFile ?? false,
          envFilePath: ['.env', '../../.env'],
          // A load factory keeps the validated values out of process.env (no cross-test leakage).
          load: [() => ({ ...(options.raw ? validateEnv(options.raw) : loadEnv()) })],
        }),
      ],
    };
  }
}

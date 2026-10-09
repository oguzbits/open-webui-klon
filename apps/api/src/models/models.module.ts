import { Module } from '@nestjs/common';

import { AuditModule } from '../database/audit/audit.module.js';
import { SafeFetchModule } from '../http/safe-fetch/safe-fetch.module.js';
import { ModelListCache } from './model-list-cache.js';
import { ModelRegistryService } from './model-registry.service.js';
import { ModelsController } from './models.controller.js';
import { OllamaAdapter } from './ollama.adapter.js';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter.js';
import { PROVIDER_ADAPTERS, type ProviderAdapter } from './provider-adapter.js';
import { ProviderConnectionsController } from './provider-connections.controller.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import { SecretBox } from './secret-box.js';

@Module({
  imports: [AuditModule, SafeFetchModule],
  controllers: [ProviderConnectionsController, ModelsController],
  providers: [
    SecretBox,
    ModelListCache,
    ProviderConnectionsService,
    OllamaAdapter,
    OpenAiCompatibleAdapter,
    {
      provide: PROVIDER_ADAPTERS,
      inject: [OllamaAdapter, OpenAiCompatibleAdapter],
      useFactory: (ollama: OllamaAdapter, openai: OpenAiCompatibleAdapter): ProviderAdapter[] => [
        ollama,
        openai,
      ],
    },
    ModelRegistryService,
  ],
  exports: [ModelRegistryService],
})
export class ModelsModule {}

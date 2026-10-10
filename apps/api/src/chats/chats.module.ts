import { Module } from '@nestjs/common';

import { ModelsModule } from '../models/models.module.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { MessageTreeService } from './message-tree.service.js';

@Module({
  imports: [ModelsModule],
  controllers: [ChatsController],
  providers: [ChatsService, MessageTreeService],
  exports: [ChatsService, MessageTreeService],
})
export class ChatsModule {}

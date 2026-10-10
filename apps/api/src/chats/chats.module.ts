import { Module } from '@nestjs/common';

import { ModelsModule } from '../models/models.module.js';
import { ChatStreamService } from './chat-stream.service.js';
import { ChatTitleService } from './chat-title.service.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { MessageTreeService } from './message-tree.service.js';
import { StreamSlots } from './stream-slots.js';

@Module({
  imports: [ModelsModule],
  controllers: [ChatsController],
  providers: [ChatsService, MessageTreeService, StreamSlots, ChatTitleService, ChatStreamService],
  exports: [ChatsService, MessageTreeService],
})
export class ChatsModule {}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators.js';
import type { User } from '../users/user.entity.js';
import {
  ChatDetailDto,
  ChatListDto,
  CreateChatDto,
  ListChatsQueryDto,
  UpdateChatDto,
} from './chats.dto.js';
import { ChatsService } from './chats.service.js';

/** Every signed-in user (not "pending"); the global guard closes the routes for everybody else. */
@ApiTags('chats')
@Controller('chats')
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  @ApiOkResponse({ type: ChatListDto })
  @ApiUnprocessableEntityResponse({ description: 'The cursor is not valid' })
  list(@CurrentUser() user: User, @Query() query: ListChatsQueryDto): Promise<ChatListDto> {
    return this.chats.list(user.id, query);
  }

  @Post()
  @ApiCreatedResponse({ type: ChatDetailDto })
  @ApiNotFoundResponse({ description: 'The model is not available' })
  @ApiUnprocessableEntityResponse({ description: 'The system prompt is too long' })
  async create(@CurrentUser() user: User, @Body() dto: CreateChatDto): Promise<ChatDetailDto> {
    const chat = await this.chats.create(user.id, dto);
    return this.chats.getDetail(user.id, chat.id);
  }

  @Get(':id')
  @ApiOkResponse({ type: ChatDetailDto })
  @ApiNotFoundResponse()
  detail(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<ChatDetailDto> {
    return this.chats.getDetail(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ChatDetailDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({
    description: 'The title is blank or the system prompt is too long',
  })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChatDto
  ): Promise<ChatDetailDto> {
    await this.chats.update(user.id, id, dto);
    return this.chats.getDetail(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.chats.remove(user.id, id);
  }
}

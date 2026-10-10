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
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators.js';
import type { User } from '../users/user.entity.js';
import {
  ChatDetailDto,
  ChatListDto,
  CreateChatDto,
  ListChatsQueryDto,
  StreamChatDto,
  UpdateChatDto,
} from './chats.dto.js';
import { ChatStreamService } from './chat-stream.service.js';
import { ChatsService } from './chats.service.js';

/** An answer costs model time: keep the rate low (the concurrent-stream limit is the hard cap). */
const STREAM_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/** Every signed-in user (not "pending"); the global guard closes the routes for everybody else. */
@ApiTags('chats')
@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chats: ChatsService,
    private readonly streams: ChatStreamService
  ) {}

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

  @Post(':id/stream')
  @Throttle(STREAM_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'AI SDK UI message stream (server-sent events)' })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({ description: 'The message is empty or too long' })
  @ApiTooManyRequestsResponse({ description: 'Too many answers run at the same time' })
  async stream(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StreamChatDto,
    @Res() response: Response
  ): Promise<void> {
    await this.streams.stream(user.id, id, dto, response);
  }

  @Post(':id/messages/:messageId/regenerate')
  @Throttle(STREAM_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'AI SDK UI message stream (server-sent events)' })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({ description: 'Only an answer can be regenerated' })
  @ApiTooManyRequestsResponse({ description: 'Too many answers run at the same time' })
  async regenerate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() response: Response
  ): Promise<void> {
    await this.streams.regenerate(user.id, id, messageId, response);
  }
}

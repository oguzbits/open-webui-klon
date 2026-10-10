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
  Put,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiBadRequestResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators.js';
import type { User } from '../users/user.entity.js';
import { CollectionsService } from './collections.service.js';
import {
  CollectionDto,
  CollectionListDto,
  CreateCollectionDto,
  DocumentListDto,
  UpdateCollectionDto,
} from './knowledge.dto.js';

/** Collections of the signed-in user; somebody else's collection answers 404 like a missing one. */
@ApiTags('collections')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @ApiOkResponse({ type: CollectionListDto })
  async list(@CurrentUser() user: User): Promise<CollectionListDto> {
    return { items: await this.collections.list(user.id) };
  }

  @Post()
  @ApiCreatedResponse({ type: CollectionDto })
  @ApiConflictResponse({ description: 'A collection with this name already exists' })
  @ApiBadRequestResponse({
    description: 'The name is empty or too long, or the body has unknown fields',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateCollectionDto): Promise<CollectionDto> {
    return this.collections.create(user.id, dto.name);
  }

  @Get(':id')
  @ApiOkResponse({ type: CollectionDto })
  @ApiNotFoundResponse()
  detail(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<CollectionDto> {
    return this.collections.get(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CollectionDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'A collection with this name already exists' })
  @ApiBadRequestResponse({
    description: 'The name is empty or too long, or the body has unknown fields',
  })
  rename(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionDto
  ): Promise<CollectionDto> {
    return this.collections.rename(user.id, id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The collection is gone; its documents stay' })
  @ApiNotFoundResponse()
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.collections.remove(user.id, id);
  }

  @Get(':id/documents')
  @ApiOkResponse({ type: DocumentListDto })
  @ApiNotFoundResponse()
  async documents(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<DocumentListDto> {
    return { items: await this.collections.listDocuments(user.id, id) };
  }

  @Put(':id/documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The document is in the collection' })
  @ApiNotFoundResponse()
  addDocument(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string
  ): Promise<void> {
    return this.collections.addDocument(user.id, id, documentId);
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The document is no longer in the collection' })
  @ApiNotFoundResponse()
  removeDocument(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string
  ): Promise<void> {
    return this.collections.removeDocument(user.id, id, documentId);
  }
}

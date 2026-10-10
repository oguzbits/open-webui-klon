import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators.js';
import type { User } from '../users/user.entity.js';
import { DocumentsService } from './documents.service.js';
import { decodeMultipartName } from './file-name.js';
import { DocumentDto, DocumentListDto, UploadDocumentDto } from './knowledge.dto.js';

/** Parsing and embedding cost real work: a few uploads per minute are plenty for a person. */
const UPLOAD_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

/** Documents of the signed-in user; somebody else's document answers 404 like a missing one. */
@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ApiOkResponse({ type: DocumentListDto })
  async list(@CurrentUser() user: User): Promise<DocumentListDto> {
    return { items: await this.documents.list(user.id) };
  }

  @Post()
  @Throttle(UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        collectionId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ type: DocumentDto, description: 'A new document, waiting to be read' })
  @ApiOkResponse({ type: DocumentDto, description: 'The same content was uploaded before' })
  @ApiNotFoundResponse({ description: 'The collection does not exist' })
  @ApiConflictResponse({ description: 'The document limit is reached' })
  @ApiPayloadTooLargeResponse({ description: 'The file is too large' })
  @ApiUnsupportedMediaTypeResponse({ description: 'The file type is not supported' })
  @ApiUnprocessableEntityResponse({ description: 'There is no file' })
  @ApiServiceUnavailableResponse({ description: 'knowledge_unavailable' })
  async upload(
    @CurrentUser() user: User,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Body() dto: UploadDocumentDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<DocumentDto> {
    if (file === undefined) throw new UnprocessableEntityException('The file is missing');
    const { document, created } = await this.documents.upload(
      user.id,
      { originalname: decodeMultipartName(file.originalname), buffer: file.buffer },
      dto.collectionId
    );
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return document;
  }

  @Post(':id/retry')
  @Throttle(UPLOAD_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DocumentDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'The document has not failed' })
  @ApiServiceUnavailableResponse({ description: 'knowledge_unavailable' })
  retry(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentDto> {
    return this.documents.retry(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.documents.remove(user.id, id);
  }
}

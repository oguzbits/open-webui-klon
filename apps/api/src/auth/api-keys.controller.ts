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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { User } from '../users/user.entity.js';
import { ApiKeyManagementService } from './api-key-management.service.js';
import { ApiKeyDto, CreatedApiKeyDto, CreateApiKeyDto, toApiKeyDto } from './api-keys.dto.js';
import { CurrentUser, SessionOnly } from './decorators.js';

/** Keys are managed from the browser session only; a key can never mint or revoke keys. */
@ApiTags('api-keys')
@SessionOnly()
@Controller('auth/api-keys')
export class ApiKeysController {
  constructor(private readonly management: ApiKeyManagementService) {}

  @Get()
  @ApiOkResponse({ type: ApiKeyDto, isArray: true })
  @ApiNotFoundResponse({ description: 'API keys are switched off' })
  async list(@CurrentUser() user: User): Promise<ApiKeyDto[]> {
    return (await this.management.list(user.id)).map(toApiKeyDto);
  }

  @Post()
  @ApiCreatedResponse({ type: CreatedApiKeyDto })
  @ApiNotFoundResponse({ description: 'API keys are switched off' })
  async create(@CurrentUser() user: User, @Body() dto: CreateApiKeyDto): Promise<CreatedApiKeyDto> {
    const { apiKey, key } = await this.management.create(user.id, dto);
    return { ...toApiKeyDto(apiKey), key };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Unknown key, not yours, or already revoked' })
  async revoke(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.management.revoke(user.id, id);
  }
}

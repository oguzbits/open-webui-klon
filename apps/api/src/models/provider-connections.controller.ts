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
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser, Roles } from '../auth/decorators.js';
import type { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';
import { ModelRegistryService } from './model-registry.service.js';
import { AdminModelListDto, ConnectionTestDto } from './models.dto.js';
import {
  CreateProviderConnectionDto,
  ProviderConnectionDto,
  toProviderConnectionDto,
  UpdateProviderConnectionDto,
} from './provider-connections.dto.js';
import { ProviderConnectionsService } from './provider-connections.service.js';

/** A test is a request to a host the admin chose: keep the rate low (error reasons are coarse on purpose). */
const TEST_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** Admin only; the guard also keeps API keys out of every route that asks for the admin role. */
@ApiTags('provider-connections')
@Roles(USER_ROLE.ADMIN)
@Controller('admin/provider-connections')
export class ProviderConnectionsController {
  constructor(
    private readonly connections: ProviderConnectionsService,
    private readonly registry: ModelRegistryService
  ) {}

  @Get()
  @ApiOkResponse({ type: ProviderConnectionDto, isArray: true })
  async list(): Promise<ProviderConnectionDto[]> {
    return (await this.connections.list()).map(toProviderConnectionDto);
  }

  @Post()
  @ApiCreatedResponse({ type: ProviderConnectionDto })
  @ApiConflictResponse({ description: 'The name is taken' })
  @ApiUnprocessableEntityResponse({ description: 'The URL is invalid or the host is not allowed' })
  async create(
    @CurrentUser() actor: User,
    @Body() dto: CreateProviderConnectionDto
  ): Promise<ProviderConnectionDto> {
    return toProviderConnectionDto(await this.connections.create(actor.id, dto));
  }

  @Patch(':id')
  @ApiOkResponse({ type: ProviderConnectionDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'The name is taken' })
  @ApiUnprocessableEntityResponse({ description: 'The URL is invalid or the host is not allowed' })
  async update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderConnectionDto
  ): Promise<ProviderConnectionDto> {
    return toProviderConnectionDto(await this.connections.update(actor.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.connections.remove(actor.id, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @Throttle(TEST_THROTTLE)
  @ApiOkResponse({ type: ConnectionTestDto })
  @ApiNotFoundResponse()
  @ApiBadGatewayResponse({ description: 'The provider did not answer; the body names the reason' })
  test(@Param('id', ParseUUIDPipe) id: string): Promise<ConnectionTestDto> {
    return this.registry.test(id);
  }

  @Get(':id/models')
  @ApiOkResponse({ type: AdminModelListDto })
  @ApiNotFoundResponse()
  @ApiBadGatewayResponse({ description: 'The provider did not answer; the body names the reason' })
  models(@Param('id', ParseUUIDPipe) id: string): Promise<AdminModelListDto> {
    return this.registry.listForConnection(id);
  }
}

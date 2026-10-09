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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser, Roles } from '../auth/decorators.js';
import { PasswordHasher } from './password-hasher.js';
import type { User } from './user.entity.js';
import { USER_ROLE } from './user-role.js';
import {
  CreateUserDto,
  SetUserPasswordDto,
  toUserDto,
  UpdateUserDto,
  UserDto,
} from './users.dto.js';
import { UsersService } from './users.service.js';

/** Admin only. The guard also keeps API keys out of every route that asks for the admin role. */
@ApiTags('users')
@Roles(USER_ROLE.ADMIN)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher
  ) {}

  @Get()
  @ApiOkResponse({ type: UserDto, isArray: true })
  async list(): Promise<UserDto[]> {
    return (await this.users.list()).map(toUserDto);
  }

  @Post()
  @ApiCreatedResponse({ type: UserDto })
  async create(@CurrentUser() actor: User, @Body() dto: CreateUserDto): Promise<UserDto> {
    const passwordHash = await this.hasher.hash(dto.password);
    const created = await this.users.createByAdmin(actor.id, {
      email: dto.email,
      name: dto.name,
      passwordHash,
      role: dto.role,
    });
    return toUserDto(created);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserDto })
  @ApiNotFoundResponse()
  async update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto
  ): Promise<UserDto> {
    return toUserDto(await this.users.update(actor.id, id, dto));
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async setPassword(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserPasswordDto
  ): Promise<void> {
    await this.users.resetPassword(actor.id, id, await this.hasher.hash(dto.password));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.users.remove(actor.id, id);
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { emailTransform } from './email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy.js';
import type { User } from './user.entity.js';
import { USER_ROLE, type UserRole } from './user-role.js';

export function trimTransform({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UserDto {
  id!: string;
  email!: string;
  name!: string;
  @ApiProperty({ enum: Object.values(USER_ROLE) })
  role!: UserRole;
  disabled!: boolean;
  createdAt!: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

const ROLES = Object.values(USER_ROLE);

export class CreateUserDto {
  @Transform(emailTransform)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: UserRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

export class SetUserPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

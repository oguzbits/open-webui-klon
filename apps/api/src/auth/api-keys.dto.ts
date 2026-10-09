import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { trimTransform } from '../users/users.dto.js';
import type { ApiKey } from './api-key.entity.js';

export class CreateApiKeyDto {
  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 365,
    description: 'Without a value the key never expires',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class ApiKeyDto {
  id!: string;
  name!: string;
  /** The first characters of the key, to tell keys apart in a list. */
  prefix!: string;
  @ApiProperty({ type: String, nullable: true })
  expiresAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastUsedAt!: string | null;
  createdAt!: string;
}

export class CreatedApiKeyDto extends ApiKeyDto {
  /** The only time the full key is shown. */
  key!: string;
}

export function toApiKeyDto(apiKey: ApiKey): ApiKeyDto {
  return {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
  };
}

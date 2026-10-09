import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import type { ProviderConnection } from './provider-connection.entity.js';
import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

const TYPES = Object.values(PROVIDER_TYPE);

/** Printable ASCII without spaces: a pasted key with a line break or trailing text cannot become a broken header. */
const API_KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;
const API_KEY_MESSAGE = 'apiKey must be 1 to 512 printable characters without spaces';

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ProviderConnectionDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: TYPES })
  type!: ProviderType;
  baseUrl!: string;
  /** The key itself is never returned. */
  hasApiKey!: boolean;
  enabled!: boolean;
  /** Raw model ids of the provider that users do not see. */
  hiddenModelIds!: string[];
  createdAt!: string;
  updatedAt!: string;
}

export function toProviderConnectionDto(connection: ProviderConnection): ProviderConnectionDto {
  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    baseUrl: connection.baseUrl,
    hasApiKey: connection.apiKeyCiphertext !== null,
    enabled: connection.enabled,
    hiddenModelIds: connection.hiddenModelIds,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export class CreateProviderConnectionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  type!: ProviderType;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  baseUrl!: string;

  /** Leave it out for a provider without a key; an empty or null value is refused. */
  @ApiPropertyOptional()
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @Transform(trim)
  @Matches(API_KEY_PATTERN, { message: API_KEY_MESSAGE })
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateProviderConnectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  baseUrl?: string;

  /** Missing: keep the key. `null`: remove it. A string: replace it. */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trim)
  @Matches(API_KEY_PATTERN, { message: API_KEY_MESSAGE })
  apiKey?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** The complete list of hidden raw model ids; it replaces the stored list. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(512, { each: true })
  hiddenModelIds?: string[];
}

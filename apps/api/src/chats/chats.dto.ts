import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  CHAT_TITLE_SOURCE,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  type ChatTitleSource,
  type MessageRole,
  type MessageStatus,
} from './chat-dictionaries.js';
import { ChatParams, type MessagePart, type MessageSource } from './chat-params.js';

/** Hard ceilings of the DTOs; the configured limits (smaller) are checked in the services. */
export const DTO_TEXT_CEILING = 200000;
export const MAX_CHAT_COLLECTIONS = 10;

export class CreateChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  modelId!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(DTO_TEXT_CEILING)
  systemPrompt?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatParams)
  params?: ChatParams;
}

export class UpdateChatDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  modelId?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(DTO_TEXT_CEILING)
  systemPrompt?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatParams)
  params?: ChatParams;

  /** Switch the shown branch: the newest leaf below this message becomes the active one. */
  @IsOptional()
  @IsUUID()
  activeMessageId?: string;

  /** Collections searched for every answer (replaces the list). Each must belong to the user, else 404. */
  @ApiPropertyOptional({ type: [String], maxItems: MAX_CHAT_COLLECTIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHAT_COLLECTIONS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  collectionIds?: string[];
}

export class ListChatsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ChatSummaryDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;
  modelId!: string;
  updatedAt!: Date;
}

export class ChatListDto {
  @ApiProperty({ type: [ChatSummaryDto] })
  items!: ChatSummaryDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class MessagePartDto {
  @ApiProperty({ enum: ['text'] })
  type!: 'text';
  text!: string;
}

export class MessageSourceDto {
  @ApiProperty({ minimum: 1 })
  n!: number;
  documentId!: string;
  filename!: string;
  @ApiProperty({ type: Number, nullable: true })
  page!: number | null;
  excerpt!: string;
}

export class MessageDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;
  @ApiProperty({ enum: Object.values(MESSAGE_ROLE) })
  role!: MessageRole;
  @ApiProperty({ type: [MessagePartDto] })
  parts!: MessagePart[];
  /** The sources sent to the model for this answer; null if no search ran. */
  @ApiProperty({ type: [MessageSourceDto], nullable: true })
  sources!: MessageSource[] | null;
  @ApiProperty({ enum: Object.values(MESSAGE_STATUS) })
  status!: MessageStatus;
  @ApiProperty({ type: String, nullable: true })
  errorReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  modelId!: string | null;
  createdAt!: Date;
}

export class ChatDetailDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;
  @ApiProperty({ enum: Object.values(CHAT_TITLE_SOURCE) })
  titleSource!: ChatTitleSource;
  modelId!: string;
  @ApiProperty({ type: String, nullable: true })
  systemPrompt!: string | null;
  @ApiProperty({ type: ChatParams })
  params!: ChatParams;
  /** Collections searched for every answer; deleted ones are left out. */
  @ApiProperty({ type: [String] })
  collectionIds!: string[];
  @ApiProperty({ type: String, nullable: true })
  activeLeafId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  @ApiProperty({ type: [MessageDto] })
  messages!: MessageDto[];
}

export class StreamChatDto {
  /** The message the new one answers to; `null` starts a new root (first message, or an edited first message). */
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DTO_TEXT_CEILING)
  text!: string;
}

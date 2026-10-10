import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import {
  DOCUMENT_FAILURE,
  DOCUMENT_STATUS,
  DOCUMENT_TYPE,
  type DocumentFailure,
  type DocumentStatus,
  type DocumentType,
} from './rag-dictionaries.js';

export const COLLECTION_NAME_MAX = 100;

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCollectionDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(COLLECTION_NAME_MAX)
  name!: string;
}

export class UpdateCollectionDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(COLLECTION_NAME_MAX)
  name!: string;
}

export class CollectionDto {
  id!: string;
  name!: string;
  documentCount!: number;
  createdAt!: Date;
}

export class CollectionListDto {
  @ApiProperty({ type: [CollectionDto] })
  items!: CollectionDto[];
}

/** The text fields of the multipart upload; the file itself is not part of the DTO. */
export class UploadDocumentDto {
  @IsOptional()
  @IsUUID()
  collectionId?: string;
}

export class DocumentDto {
  id!: string;
  filename!: string;
  @ApiProperty({ enum: Object.values(DOCUMENT_TYPE) })
  type!: DocumentType;
  sizeBytes!: number;
  @ApiProperty({ enum: Object.values(DOCUMENT_STATUS) })
  status!: DocumentStatus;
  @ApiProperty({ enum: Object.values(DOCUMENT_FAILURE), nullable: true })
  failureReason!: DocumentFailure | null;
  @ApiProperty({ type: Number, nullable: true })
  pageCount!: number | null;
  createdAt!: Date;
}

export class DocumentListDto {
  @ApiProperty({ type: [DocumentDto] })
  items!: DocumentDto[];
}

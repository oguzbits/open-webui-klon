import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Collection } from './collection.entity.js';
import { Document } from './document.entity.js';

/** A document can sit in several collections; removing a collection only removes the link. */
@Entity({ name: 'collection_document' })
@Index('collection_document_document_idx', ['documentId'])
export class CollectionDocument {
  @PrimaryColumn({ name: 'collection_id', type: 'uuid' })
  collectionId!: string;

  @ManyToOne(() => Collection, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'collection_id' })
  collection!: Collection;

  @PrimaryColumn({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @ManyToOne(() => Document, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: Document;
}

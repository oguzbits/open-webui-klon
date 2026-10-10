import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledge1791652410645 implements MigrationInterface {
  name = 'AddKnowledge1791652410645';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "document" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "sha256" text NOT NULL, "filename" text NOT NULL, "type" text NOT NULL, "size_bytes" integer NOT NULL, "status" text NOT NULL DEFAULT 'pending', "failure_reason" text, "storage_key" uuid NOT NULL, "page_count" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "document_sha256_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'), CONSTRAINT "document_type_check" CHECK (type IN ('pdf', 'docx', 'markdown', 'text')), CONSTRAINT "document_failure_check" CHECK (failure_reason IS NULL OR failure_reason IN ('too_large', 'too_many_pages', 'unreadable', 'timeout', 'no_text', 'embedding_failed')), CONSTRAINT "document_status_check" CHECK (status IN ('pending', 'processing', 'ready', 'failed')), CONSTRAINT "PK_e57d3357f83f3cdc0acffc3d777" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "document_user_sha256_idx" ON "document"  ("user_id", "sha256") `
    );
    await queryRunner.query(
      `CREATE TABLE "chunk" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "document_id" uuid NOT NULL, "user_id" uuid NOT NULL, "ordinal" integer NOT NULL, "content" text NOT NULL, "page" integer, "embedding" halfvec NOT NULL, "embedding_model_id" text NOT NULL, CONSTRAINT "PK_444ba832a2c514629d265d81b5f" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "chunk_document_ordinal_idx" ON "chunk"  ("document_id", "ordinal") `
    );
    await queryRunner.query(
      `CREATE INDEX "chunk_user_document_idx" ON "chunk"  ("user_id", "document_id") `
    );
    await queryRunner.query(
      `CREATE TABLE "collection" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "name" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ad3f485bbc99d875491f44d7c85" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "collection_user_name_idx" ON "collection"  ("user_id", "name") `
    );
    await queryRunner.query(
      `CREATE TABLE "collection_document" ("collection_id" uuid NOT NULL, "document_id" uuid NOT NULL, CONSTRAINT "PK_3118bd8665b33d32eb14d249dfb" PRIMARY KEY ("collection_id", "document_id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "collection_document_document_idx" ON "collection_document"  ("document_id") `
    );
    await queryRunner.query(
      `ALTER TABLE "chat" ADD "collection_ids" uuid array NOT NULL DEFAULT '{}'`
    );
    await queryRunner.query(`ALTER TABLE "message" ADD "sources" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "document" ADD CONSTRAINT "FK_a24176a40152f41c98c09d8057d" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "chunk" ADD CONSTRAINT "FK_690a6e4013777feb8061731c119" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "chunk" ADD CONSTRAINT "FK_e4b712a2bb28be6a0b5f5dcfb54" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "collection" ADD CONSTRAINT "FK_4f925485b013b52e32f43d430f6" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "collection_document" ADD CONSTRAINT "FK_6474c35c935f23161c2ca370bba" FOREIGN KEY ("collection_id") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "collection_document" ADD CONSTRAINT "FK_28e86837dc584708e396a2ae29a" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collection_document" DROP CONSTRAINT "FK_28e86837dc584708e396a2ae29a"`
    );
    await queryRunner.query(
      `ALTER TABLE "collection_document" DROP CONSTRAINT "FK_6474c35c935f23161c2ca370bba"`
    );
    await queryRunner.query(
      `ALTER TABLE "collection" DROP CONSTRAINT "FK_4f925485b013b52e32f43d430f6"`
    );
    await queryRunner.query(`ALTER TABLE "chunk" DROP CONSTRAINT "FK_e4b712a2bb28be6a0b5f5dcfb54"`);
    await queryRunner.query(`ALTER TABLE "chunk" DROP CONSTRAINT "FK_690a6e4013777feb8061731c119"`);
    await queryRunner.query(
      `ALTER TABLE "document" DROP CONSTRAINT "FK_a24176a40152f41c98c09d8057d"`
    );
    await queryRunner.query(`ALTER TABLE "message" DROP COLUMN "sources"`);
    await queryRunner.query(`ALTER TABLE "chat" DROP COLUMN "collection_ids"`);
    await queryRunner.query(`DROP INDEX "public"."collection_document_document_idx"`);
    await queryRunner.query(`DROP TABLE "collection_document"`);
    await queryRunner.query(`DROP INDEX "public"."collection_user_name_idx"`);
    await queryRunner.query(`DROP TABLE "collection"`);
    await queryRunner.query(`DROP INDEX "public"."chunk_user_document_idx"`);
    await queryRunner.query(`DROP INDEX "public"."chunk_document_ordinal_idx"`);
    await queryRunner.query(`DROP TABLE "chunk"`);
    await queryRunner.query(`DROP INDEX "public"."document_user_sha256_idx"`);
    await queryRunner.query(`DROP TABLE "document"`);
  }
}

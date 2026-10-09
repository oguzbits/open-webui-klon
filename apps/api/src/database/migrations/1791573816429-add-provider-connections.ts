import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderConnections1791573816429 implements MigrationInterface {
  name = 'AddProviderConnections1791573816429';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "provider_connection" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" text NOT NULL, "type" text NOT NULL, "base_url" text NOT NULL, "api_key_ciphertext" text, "enabled" boolean NOT NULL DEFAULT true, "hidden_model_ids" text array NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "provider_connection_type_check" CHECK (type IN ('ollama', 'openai_compatible')), CONSTRAINT "PK_287831bfc2b61bbd8668ea4c0b5" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "provider_connection_name_idx" ON "provider_connection"  ("name") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."provider_connection_name_idx"`);
    await queryRunner.query(`DROP TABLE "provider_connection"`);
  }
}

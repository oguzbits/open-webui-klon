import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChats1791625546492 implements MigrationInterface {
  name = 'AddChats1791625546492';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chat" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "title" text, "title_source" text NOT NULL DEFAULT 'fallback', "model_id" text NOT NULL, "system_prompt" text, "params" jsonb NOT NULL DEFAULT '{}', "active_leaf_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chat_title_source_check" CHECK (title_source IN ('fallback', 'generated', 'user')), CONSTRAINT "PK_9d0b2ba74336710fd31154738a5" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "chat_user_updated_idx" ON "chat"  ("user_id", "updated_at", "id") `
    );
    await queryRunner.query(
      `CREATE TABLE "message" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "chat_id" uuid NOT NULL, "parent_id" uuid, "role" text NOT NULL, "parts" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'complete', "error_reason" text, "model_id" text, "input_tokens" integer, "output_tokens" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "message_status_check" CHECK (status IN ('complete', 'aborted', 'error')), CONSTRAINT "message_role_check" CHECK (role IN ('user', 'assistant')), CONSTRAINT "PK_ba01f0a3e0123651915008bc578" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "message_chat_parent_idx" ON "message"  ("chat_id", "parent_id") `
    );
    await queryRunner.query(
      `ALTER TABLE "chat" ADD CONSTRAINT "FK_15d83eb496fd7bec7368b30dbf3" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "chat" ADD CONSTRAINT "FK_7c55e2dd74466683d4135bfcd90" FOREIGN KEY ("active_leaf_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "message" ADD CONSTRAINT "FK_859ffc7f95098efb4d84d50c632" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "message" ADD CONSTRAINT "FK_7c8f889f3f2f042fd50ba22de4b" FOREIGN KEY ("parent_id") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message" DROP CONSTRAINT "FK_7c8f889f3f2f042fd50ba22de4b"`
    );
    await queryRunner.query(
      `ALTER TABLE "message" DROP CONSTRAINT "FK_859ffc7f95098efb4d84d50c632"`
    );
    await queryRunner.query(`ALTER TABLE "chat" DROP CONSTRAINT "FK_7c55e2dd74466683d4135bfcd90"`);
    await queryRunner.query(`ALTER TABLE "chat" DROP CONSTRAINT "FK_15d83eb496fd7bec7368b30dbf3"`);
    await queryRunner.query(`DROP INDEX "public"."message_chat_parent_idx"`);
    await queryRunner.query(`DROP TABLE "message"`);
    await queryRunner.query(`DROP INDEX "public"."chat_user_updated_idx"`);
    await queryRunner.query(`DROP TABLE "chat"`);
  }
}

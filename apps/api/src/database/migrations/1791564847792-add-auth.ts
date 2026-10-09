import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuth1791564847792 implements MigrationInterface {
  name = 'AddAuth1791564847792';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "app_user" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" text NOT NULL, "name" text NOT NULL, "password_hash" text NOT NULL, "role" text NOT NULL DEFAULT 'pending', "disabled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "app_user_role_check" CHECK (role IN ('pending', 'user', 'admin')), CONSTRAINT "PK_22a5c4a3d9b2fb8e4e73fc4ada1" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "app_user_email_idx" ON "app_user"  ("email") `);
    await queryRunner.query(
      `CREATE TABLE "api_key" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "name" text NOT NULL, "key_hash" text NOT NULL, "prefix" text NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b1bd840641b8acbaad89c3d8d11" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "api_key_user_id_idx" ON "api_key"  ("user_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "api_key_key_hash_idx" ON "api_key"  ("key_hash") `
    );
    await queryRunner.query(
      `CREATE TABLE "session" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" text NOT NULL, "csrf_token" text NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f55da76ac1c3ac420f444d2ff11" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`CREATE INDEX "session_user_id_idx" ON "session"  ("user_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "session_token_hash_idx" ON "session"  ("token_hash") `
    );
    await queryRunner.query(
      `ALTER TABLE "api_key" ADD CONSTRAINT "FK_6a0830f03e537b239a53269b27d" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "session" ADD CONSTRAINT "FK_30e98e8746699fb9af235410aff" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session" DROP CONSTRAINT "FK_30e98e8746699fb9af235410aff"`
    );
    await queryRunner.query(
      `ALTER TABLE "api_key" DROP CONSTRAINT "FK_6a0830f03e537b239a53269b27d"`
    );
    await queryRunner.query(`DROP INDEX "public"."session_token_hash_idx"`);
    await queryRunner.query(`DROP INDEX "public"."session_user_id_idx"`);
    await queryRunner.query(`DROP TABLE "session"`);
    await queryRunner.query(`DROP INDEX "public"."api_key_key_hash_idx"`);
    await queryRunner.query(`DROP INDEX "public"."api_key_user_id_idx"`);
    await queryRunner.query(`DROP TABLE "api_key"`);
    await queryRunner.query(`DROP INDEX "public"."app_user_email_idx"`);
    await queryRunner.query(`DROP TABLE "app_user"`);
  }
}

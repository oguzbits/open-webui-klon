import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitFoundation1791504000000 implements MigrationInterface {
  name = 'InitFoundation1791504000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector');
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        actor_id uuid,
        action text NOT NULL,
        target_type text,
        target_id text,
        request_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await queryRunner.query('CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at)');
    await queryRunner.query(`
      CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_no_update_delete
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_no_truncate
      BEFORE TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER audit_log_no_truncate ON audit_log');
    await queryRunner.query('DROP TRIGGER audit_log_no_update_delete ON audit_log');
    await queryRunner.query('DROP TABLE audit_log');
    await queryRunner.query('DROP FUNCTION audit_log_append_only()');
  }
}

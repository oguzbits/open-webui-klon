import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { USER_ROLE, type UserRole } from './user-role.js';

const ROLE_VALUES = Object.values(USER_ROLE)
  .map((role) => `'${role}'`)
  .join(', ');

/** "user" is a reserved word in Postgres, hence app_user. The email is always stored lower-case. */
@Entity({ name: 'app_user' })
@Index('app_user_email_idx', ['email'], { unique: true })
@Check('app_user_role_check', `role IN (${ROLE_VALUES})`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text', default: USER_ROLE.PENDING })
  role!: UserRole;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

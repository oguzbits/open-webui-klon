import { ApiProperty } from '@nestjs/swagger';

import type { User } from './user.entity.js';
import { USER_ROLE, type UserRole } from './user-role.js';

export function trimTransform({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UserDto {
  id!: string;
  email!: string;
  name!: string;
  @ApiProperty({ enum: Object.values(USER_ROLE) })
  role!: UserRole;
  disabled!: boolean;
  createdAt!: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

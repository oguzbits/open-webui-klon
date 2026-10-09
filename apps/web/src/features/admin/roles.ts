import { UserDtoRole } from '@/api/generated/model';

/** The i18n key of each role; `satisfies` makes a new role in the contract a compile error here. */
export const ROLE_LABEL = {
  [UserDtoRole.pending]: 'admin.users.roles.pending',
  [UserDtoRole.user]: 'admin.users.roles.user',
  [UserDtoRole.admin]: 'admin.users.roles.admin',
} satisfies Record<UserDtoRole, string>;

/** Narrows the string of a select to a role without a cast. */
export function parseRole(value: string): UserDtoRole | undefined {
  return Object.values(UserDtoRole).find((role) => role === value);
}

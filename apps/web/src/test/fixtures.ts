import {
  type AuthConfigDto,
  type SessionInfoDto,
  type UserDto,
  UserDtoRole,
} from '@/api/generated/model';

export function userDto(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'user-1',
    email: 'ben@example.com',
    name: 'Ben Beispiel',
    role: UserDtoRole.user,
    disabled: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

export function sessionInfo(user: UserDto = userDto(), csrfToken = 'csrf-test'): SessionInfoDto {
  return { user, csrfToken };
}

export function authConfig(overrides: Partial<AuthConfigDto> = {}): AuthConfigDto {
  return { signupEnabled: true, onboarding: false, apiKeysEnabled: true, ...overrides };
}

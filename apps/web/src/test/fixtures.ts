import {
  type AdminModelDto,
  type AuthConfigDto,
  type ModelDto,
  ModelDtoProviderType,
  type ModelListDto,
  type ProviderConnectionDto,
  ProviderConnectionDtoType,
  type SessionInfoDto,
  type UnavailableConnectionDto,
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

export function providerConnectionDto(
  overrides: Partial<ProviderConnectionDto> = {}
): ProviderConnectionDto {
  return {
    id: 'c-local',
    name: 'Lokal',
    type: ProviderConnectionDtoType.ollama,
    baseUrl: 'http://localhost:11434',
    hasApiKey: false,
    enabled: true,
    hiddenModelIds: [],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

export function modelDto(overrides: Partial<ModelDto> = {}): ModelDto {
  return {
    id: 'c-local:llama3:8b',
    name: 'llama3:8b',
    connectionId: 'c-local',
    providerName: 'Lokal',
    providerType: ModelDtoProviderType.ollama,
    ...overrides,
  };
}

export function modelList(
  models: ModelDto[] = [modelDto()],
  unavailableConnections: UnavailableConnectionDto[] = []
): ModelListDto {
  return { models, unavailableConnections };
}

export function adminModel(overrides: Partial<AdminModelDto> = {}): AdminModelDto {
  return { rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false, ...overrides };
}

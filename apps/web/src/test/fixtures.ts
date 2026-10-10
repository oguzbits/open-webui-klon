import {
  type AdminModelDto,
  type AuthConfigDto,
  type ChatDetailDto,
  ChatDetailDtoTitleSource,
  type ChatListDto,
  type ChatSummaryDto,
  type MessageDto,
  MessageDtoRole,
  MessageDtoStatus,
  type MessagePartDto,
  MessagePartDtoType,
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

/** A moment of the test conversation: `chatTime(3)` is always after `chatTime(2)`, so sibling order is explicit. */
export function chatTime(second: number): string {
  return `2026-10-10T09:00:${String(second).padStart(2, '0')}.000Z`;
}

export function textParts(text: string): MessagePartDto[] {
  return [{ type: MessagePartDtoType.text, text }];
}

export function messageDto(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm-1',
    parentId: null,
    role: MessageDtoRole.user,
    parts: textParts('Hallo'),
    sources: null,
    status: MessageDtoStatus.complete,
    errorReason: null,
    modelId: null,
    createdAt: chatTime(0),
    ...overrides,
  };
}

export function chatDetailDto(overrides: Partial<ChatDetailDto> = {}): ChatDetailDto {
  return {
    id: 'c-1',
    title: 'Erster Chat',
    titleSource: ChatDetailDtoTitleSource.generated,
    modelId: 'c-local:llama3:8b',
    systemPrompt: null,
    params: {},
    collectionIds: [],
    activeLeafId: null,
    messages: [],
    createdAt: chatTime(0),
    updatedAt: chatTime(0),
    ...overrides,
  };
}

export function chatSummaryDto(overrides: Partial<ChatSummaryDto> = {}): ChatSummaryDto {
  return {
    id: 'c-1',
    title: 'Erster Chat',
    modelId: 'c-local:llama3:8b',
    updatedAt: chatTime(0),
    ...overrides,
  };
}

export function chatList(
  items: ChatSummaryDto[] = [chatSummaryDto()],
  nextCursor: string | null = null
): ChatListDto {
  return { items, nextCursor };
}

export const PROVIDER_TYPE = {
  OLLAMA: 'ollama',
  OPENAI_COMPATIBLE: 'openai_compatible',
} as const;

export type ProviderType = (typeof PROVIDER_TYPE)[keyof typeof PROVIDER_TYPE];

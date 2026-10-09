import type { ProviderConnectionDto, UpdateProviderConnectionDto } from '@/api/generated/model';

/** What happens to the stored key when the form is saved. */
export const KEY_MODE = { KEEP: 'keep', REPLACE: 'replace', REMOVE: 'remove' } as const;
export type KeyMode = (typeof KEY_MODE)[keyof typeof KEY_MODE];

export interface ConnectionForm {
  name: string;
  baseUrl: string;
  keyMode: KeyMode;
  newKey: string;
}

/**
 * The PATCH body for an edit: only what changed. The key follows the contract of the server: a missing field
 * keeps it, `null` removes it, a string replaces it.
 */
export function buildPatch(
  connection: ProviderConnectionDto,
  form: ConnectionForm
): UpdateProviderConnectionDto {
  const patch: UpdateProviderConnectionDto = {};
  const name = form.name.trim();
  const baseUrl = form.baseUrl.trim();
  const key = form.newKey.trim();
  if (name !== connection.name) patch.name = name;
  if (baseUrl !== connection.baseUrl) patch.baseUrl = baseUrl;
  if (form.keyMode === KEY_MODE.REMOVE) {
    patch.apiKey = null;
  } else if (form.keyMode === KEY_MODE.REPLACE && key !== '') {
    patch.apiKey = key;
  }
  return patch;
}

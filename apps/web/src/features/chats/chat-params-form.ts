import type { ChatParams } from '@/api/generated/model';

export const PARAM_NAME = {
  TEMPERATURE: 'temperature',
  TOP_P: 'topP',
  MAX_OUTPUT_TOKENS: 'maxOutputTokens',
} as const;

export type ParamName = (typeof PARAM_NAME)[keyof typeof PARAM_NAME];

/** The limits `ChatParams` declares in the API (chat-params.ts); the server checks them again. */
export const PARAM_LIMITS = {
  [PARAM_NAME.TEMPERATURE]: { min: 0, max: 2, integer: false },
  [PARAM_NAME.TOP_P]: { min: 0, max: 1, integer: false },
  [PARAM_NAME.MAX_OUTPUT_TOKENS]: { min: 1, max: 100000, integer: true },
} as const satisfies Record<ParamName, { min: number; max: number; integer: boolean }>;

const PARAM_NAMES: ParamName[] = Object.values(PARAM_NAME);

/** The text of each field while the user edits; empty means "the model's default". */
export type ParamsDraft = Record<ParamName, string>;

export function draftFromParams(params: ChatParams): ParamsDraft {
  return {
    [PARAM_NAME.TEMPERATURE]: params.temperature === undefined ? '' : String(params.temperature),
    [PARAM_NAME.TOP_P]: params.topP === undefined ? '' : String(params.topP),
    [PARAM_NAME.MAX_OUTPUT_TOKENS]:
      params.maxOutputTokens === undefined ? '' : String(params.maxOutputTokens),
  };
}

export type ParamsResult = { ok: true; params: ChatParams } | { ok: false; invalid: ParamName[] };

/** Plain non-negative numbers only: no exponent, no sign, no second dot. `Number()` alone would take "1e1" and " ". */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

function parseParam(name: ParamName, text: string): number | undefined {
  const normalised = text.trim().replace(',', '.');
  if (!PLAIN_NUMBER.test(normalised)) return undefined;
  const value = Number(normalised);
  const limits = PARAM_LIMITS[name];
  if (limits.integer && !Number.isInteger(value)) return undefined;
  return value >= limits.min && value <= limits.max ? value : undefined;
}

export function paramsFromDraft(draft: ParamsDraft): ParamsResult {
  const params: ChatParams = {};
  const invalid: ParamName[] = [];
  for (const name of PARAM_NAMES) {
    if (draft[name].trim() === '') continue;
    const value = parseParam(name, draft[name]);
    if (value === undefined) invalid.push(name);
    else params[name] = value;
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, params };
}

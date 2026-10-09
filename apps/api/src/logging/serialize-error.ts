interface SerializedError {
  type: string;
  message: string;
  code?: string;
  stack?: string;
}

function codeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  return typeof value.code === 'string' ? value.code : undefined;
}

/**
 * pino's default serializer copies every enumerable property. TypeORM's QueryFailedError carries the SQL text
 * and its parameters (user content), so logged errors are reduced to type, message, code and stack.
 */
export function serializeError(error: unknown): SerializedError | { message: string } {
  if (!(error instanceof Error)) return { message: 'Non-error value thrown' };
  const driverError: unknown = 'driverError' in error ? error.driverError : undefined;
  const code = codeOf(error) ?? codeOf(driverError);
  return {
    type: error.constructor.name,
    message: error.message,
    ...(code === undefined ? {} : { code }),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}

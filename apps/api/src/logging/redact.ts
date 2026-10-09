export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.apiKey',
  '*.token',
];

export const REDACT_CENSOR = '[redacted]';

import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: '../api/openapi.json',
    output: {
      mode: 'single',
      target: 'src/api/generated/api.ts',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: { mutator: { path: 'src/api/fetcher.ts', name: 'apiFetch' } },
    },
  },
});

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/web/src/api/generated/**',
      'apps/web/src/components/ui/**',
      'apps/web/src/hooks/use-mobile.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: 'No "export *": name every export.' },
        {
          selector: "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message: 'No "as unknown as": fix the type instead.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No dangerouslySetInnerHTML: model output and documents are untrusted.',
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Outgoing requests to user- or model-influenced URLs must use SafeFetchService.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'axios',
            'node-fetch',
            'got',
            'undici',
            ...['http', 'https', 'http2', 'net', 'tls'].flatMap((name) => [name, `node:${name}`]),
          ].map((name) => ({
            name,
            message: 'Use SafeFetchService (src/http/safe-fetch) for outgoing requests.',
            allowTypeImports: true,
          })),
          patterns: [],
        },
      ],
      'no-restricted-properties': [
        'error',
        ...['request', 'get'].flatMap((property) =>
          ['http', 'https'].map((object) => ({
            object,
            property,
            message: 'Use SafeFetchService for outgoing requests.',
          }))
        ),
        {
          object: 'globalThis',
          property: 'fetch',
          message: 'Use SafeFetchService for outgoing requests.',
        },
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through config/env.ts (validated, typed).',
        },
      ],
    },
  },
  {
    // supertest responses are untyped (`any`) and its handle is conventionally named `http`.
    files: ['apps/api/src/**/*.spec.ts', 'apps/api/src/testing/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    // The two places that read the process environment: validation and the Nest config module.
    files: ['apps/api/src/config/env.ts', 'apps/api/src/config/app-config.module.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // The one place that is allowed to open outgoing connections, and the fake provider test server.
    files: ['apps/api/src/http/safe-fetch/**/*.ts', 'apps/api/src/testing/fake-provider.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: globals.browser },
  },
  prettier
);

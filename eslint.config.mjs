import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
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
          paths: ['axios', 'node-fetch', 'got', 'undici', 'node:https', 'https'].map((name) => ({
            name,
            message: 'Use SafeFetchService (src/http/safe-fetch) for outgoing requests.',
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
      ],
    },
  },
  {
    // The one place that is allowed to open outgoing connections.
    files: ['apps/api/src/http/safe-fetch/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  prettier
);

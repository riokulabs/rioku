import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import boundaries from 'eslint-plugin-boundaries';
import noPiiInUrl from './eslint-rules/no-pii-in-url.cjs';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      '.tsc-node-out',
      'src/routeTree.gen.ts',
      'sample-plugin/dist/**',
      'sample-plugin/node_modules/**',
      // go:embed build output from `make build-daemon` — minified SPA
      // bundle lands here; ESLint shouldn't lint built artifacts.
      '../daemon/web/build/**',
      '**/daemon/web/build/**',
      // Orval-generated client (committed per CI drift gate, regenerable
      // via `make web-types`). Linting generated code surfaces irrelevant
      // rule violations (e.g. react-hooks/immutability on the standard
      // tanstack-query queryKey assignment pattern, deprecated zod helpers
      // we don't control, etc.). Treat the OpenAPI spec as the contract.
      'src/api/generated/**',
      // Tooling configs and custom ESLint rules (.cjs Node scripts) live
      // outside the typed source tree; the strict typed-eslint preset
      // can't resolve them via tsconfig and `console`/`require` globals
      // aren't part of the browser type lib.
      'orval.config.ts',
      'vitest.config.ts',
      'eslint-rules/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      boundaries,
    },
    settings: {
      react: { version: '19.2' },
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/*' },
        { type: 'host', pattern: 'src/host/*' },
        { type: 'features', pattern: 'src/features/*', capture: ['name'] },
        { type: 'components', pattern: 'src/components/*' },
        { type: 'layout', pattern: 'src/layout/*' },
        { type: 'routes', pattern: 'src/routes/*' },
        { type: 'api', pattern: 'src/api/*' },
        // Static OpenAPI snapshot served to Scalar. Typed as its own element
        // so features (specifically the api-explorer feature) can import the
        // generated JSON data without tripping the "no cross-feature" rule.
        { type: 'api-explorer-data', pattern: 'src/api-explorer/*' },
        { type: 'hooks', pattern: 'src/hooks/*' },
        { type: 'theme', pattern: 'src/theme/*' },
        { type: 'i18n', pattern: 'src/i18n/*' },
        { type: 'lib', pattern: 'src/lib/*' },
        { type: 'test', pattern: 'src/test/*' },
      ],
      'boundaries/include': ['src/**/*'],
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',

      // B2 enforcement: first-party admin code cannot import @rioku/plugin-sdk
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@rioku/plugin-sdk', '@rioku/plugin-sdk/*'],
              message:
                'First-party admin code imports Mantine/React/TanStack directly. @rioku/plugin-sdk is for plugins only (spec §9.10.1 B2).',
            },
          ],
        },
      ],

      // Feature-first dependency rules (spec §13.1)
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'app', allow: ['*'] },
            {
              from: 'routes',
              allow: ['features', 'layout', 'components', 'hooks', 'api', 'lib', 'theme', 'i18n'],
            },
            {
              from: 'features',
              allow: [
                'components',
                'hooks',
                'api',
                'lib',
                'theme',
                'i18n',
                'host',
                'api-explorer-data',
              ],
            },
            { from: 'api-explorer-data', allow: [] },
            {
              from: 'layout',
              allow: ['features', 'components', 'hooks', 'api', 'lib', 'theme', 'i18n'],
            },
            { from: 'components', allow: ['hooks', 'lib', 'theme', 'i18n'] },
            { from: 'host', allow: ['lib', 'theme'] },
            { from: 'hooks', allow: ['api', 'lib', 'host', 'theme', 'i18n'] },
            { from: 'api', allow: ['lib', 'host'] },
            { from: 'theme', allow: ['lib'] },
            { from: 'i18n', allow: ['lib'] },
            { from: 'lib', allow: [] },
            { from: 'test', allow: ['*'] },
          ],
        },
      ],
      // No cross-feature imports
      'boundaries/no-private': ['error', { allowUncles: false }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      rioku: { rules: { 'no-pii-in-url': noPiiInUrl } },
    },
    rules: {
      'rioku/no-pii-in-url': 'warn',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*', 'e2e/**/*'],
    rules: {
      'boundaries/element-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    files: ['src/host/sdk.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Sample plugin — sits under packages/web/ for dev-sideload convenience but
    // plays the role of an out-of-tree plugin. Importing @rioku/plugin-sdk and
    // bypassing the B2 boundary rules is intentional.
    files: ['sample-plugin/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      'boundaries/element-types': 'off',
      'boundaries/no-private': 'off',
    },
  },
  {
    // Node.js scripts — allow Node globals, disable browser/React rules
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    rules: {
      'no-undef': 'off', // TypeScript checks names and browser globals.
      '@typescript-eslint/no-explicit-any': 'off', // Runtime adapters use untyped third-party values.
      'no-control-regex': 'off', // Path guards intentionally reject control bytes.
      'preserve-caught-error': 'warn',
      'no-useless-assignment': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off', // Browser probes use terse assertions.
      '@typescript-eslint/no-this-alias': 'off', // Test doubles sometimes preserve their handle.
    },
  },
);

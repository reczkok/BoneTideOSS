import { defineConfig } from 'oxlint';
import typegpu from 'eslint-plugin-typegpu';

export default defineConfig({
  ignorePatterns: ['.agents/**'],
  plugins: ['typescript', 'import', 'unicorn', 'oxc', 'react'],
  jsPlugins: ['eslint-plugin-typegpu'],
  categories: {
    correctness: 'warn',
    suspicious: 'warn',
  },
  rules: {
    ...typegpu.configs.recommended.rules,
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-unsafe-type-assertion': 'off',
    'import/no-named-as-default': 'off',
    'unicorn/consistent-function-scoping': 'off',
    'oxc/approx-constant': 'off',
    'unicorn/no-array-sort': 'off',
    'unicorn/no-array-reverse': 'off',
    'no-underscore-dangle': 'off',
    'import/no-unassigned-import': 'off',
  },
  overrides: [
    {
      files: ['packages/engine/src/assets/gltf.ts'],
      rules: { 'typescript/no-explicit-any': 'off' },
    },
  ],
  env: {
    builtin: true,
  },
});

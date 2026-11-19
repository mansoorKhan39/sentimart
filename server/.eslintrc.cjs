module.exports = {
  root: true,
  env: { node: true, es2022: true, jest: true },
  globals: { fetch: 'readonly', FormData: 'readonly', Blob: 'readonly', AbortSignal: 'readonly' },
  parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
  extends: ['eslint:recommended', 'prettier'],
  rules: {
    eqeqeq: 'error',
    'no-console': 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
  },
};

module.exports = {
  root: true,
  env: { node: true, es2022: true, jest: true },
  parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
  extends: ['eslint:recommended', 'prettier'],
  rules: {
    eqeqeq: 'error',
    'no-console': 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
  },
};

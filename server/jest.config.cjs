// CommonJS on purpose: Jest 29 fails to load an ESM jest.config.js on newer Node versions.
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/helpers/setup-env.js'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  transform: {},
  testTimeout: 30000,
};

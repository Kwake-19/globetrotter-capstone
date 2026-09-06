module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Phase 2's microservices under services/ each have their own jest setup
  // and are run independently (cd services/<name> && npm test). Keep the
  // repo-root `npm test` scoped to the Phase 1 monolith exactly as before.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/services/'],
  verbose: true,
  clearMocks: true
};

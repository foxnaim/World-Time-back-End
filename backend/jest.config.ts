import type { Config } from 'jest';

/**
 * Jest unit-test config for the NestJS backend.
 *
 * ts-jest runs TypeScript in-process so no separate build step is needed.
 * Path aliases here mirror tsconfig.json:
 *   @/*          -> src/*
 *   @tact/*  -> ../packages/*\/src   (workspace packages)
 *
 * e2e specs live under backend/test/ and have their own config
 * (see backend/jest-e2e.config.ts), so this config only matches *.spec.ts.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js'],
  testRegex: '.*\\.spec\\.ts$',
  // `.js` is routed through ts-jest only for the ESM-only packages that
  // transformIgnorePatterns lets through (nanoid 5 ships `import` syntax and
  // no CommonJS build); ts-jest transpiles node_modules JS to CommonJS.
  // The optional `.pnpm/nanoid@x/` segment matches pnpm's real paths.
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { isolatedModules: true }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/)?nanoid[@/])'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tact/(.*)$': '<rootDir>/../packages/$1/src',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: './coverage',
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  // Telegram ids are BigInt. Child-process workers send results as JSON, so a
  // failed BigInt assertion crashed the report ("Do not know how to serialize
  // a BigInt") and hid the failure; worker threads use structured clone.
  workerThreads: true,
};

export default config;

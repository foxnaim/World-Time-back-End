import type { Config } from 'jest';

/**
 * Jest e2e config. Boots the NestJS app and hits it over supertest.
 *
 * rootDir is the ./test directory so test files can reference fixtures and
 * setup by relative path. Path aliases match the unit config.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: './test',
  moduleFileExtensions: ['ts', 'js'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../src/$1',
    '^@tact/(.*)$': '<rootDir>/../../packages/$1/src',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
};

export default config;

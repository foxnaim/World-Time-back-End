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
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tact/(.*)$': '<rootDir>/../packages/$1/src',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: './coverage',
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
};

export default config;

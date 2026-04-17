# Backend Testing

This document is the canonical reference for the NestJS backend's test suite.
It describes the three-layer strategy, the conventions each layer follows, and
the exact commands used day to day.

Three layers:

1. **Unit** — Jest, per-service `.spec.ts` co-located next to source
2. **Integration** — Jest with a real Prisma client against a disposable test
   database (same runner as unit, but gated by `DATABASE_URL_TEST`)
3. **E2E** — Jest + Supertest living under `test/`, booting the full
   `AppModule` the same way `main.ts` does

Each layer trades speed for fidelity. Push as much coverage as possible down to
the unit layer and only reach for E2E when you specifically need to exercise
pipes, guards, interceptors or the HTTP boundary.

## Tools

| Tool | Version | Role |
|------|---------|------|
| `jest` | ^29 | Test runner |
| `ts-jest` | ^29 | In-process TypeScript transform (`isolatedModules: true`) |
| `supertest` | ^7 | HTTP assertions against a running Nest app |
| `@nestjs/testing` | ^10 | `Test.createTestingModule` for DI-driven fixtures |
| `nock` | opt-in | Out-of-band HTTP mocking (Google Sheets, Telegram, SMTP) |
| `jest-mock-extended` | opt-in | `mockDeep<PrismaService>()` ergonomics |

`ts-jest` is configured with `isolatedModules: true` in both configs, which
skips cross-file type checking during test runs. Type errors still surface via
`pnpm lint` and the NestJS build in CI.

## Layout

```
backend/
├── src/modules/<name>/<name>.service.spec.ts   # unit, co-located
├── test/
│   ├── app.e2e-spec.ts                         # e2e specs (TestingModule + supertest)
│   ├── fixtures/                               # shared factories and sample payloads
│   ├── jest.setup.ts                           # env setup for both configs
│   └── setup.ts                                # helpers (DB truncation, JWT signing, ...)
├── jest.config.ts                              # unit + integration runner
└── jest-e2e.config.ts                          # e2e runner
```

Both configs share the same path aliases so imports work identically:

| Alias | Resolves to |
|-------|-------------|
| `@/*` | `backend/src/*` |
| `@worktime/*` | `../packages/*/src` (workspace packages) |

## Running

All commands assume `pnpm` and are run from `backend/`:

| Command | Purpose |
|---------|---------|
| `pnpm test` | All unit specs (`src/**/*.spec.ts` + `test/**/*.spec.ts`) |
| `pnpm test:watch` | Unit in watch mode — useful for TDD |
| `pnpm test:cov` | Unit + coverage report (`backend/coverage/`) |
| `pnpm test:e2e` | E2E suite (`jest --config ./jest-e2e.config.ts`) |

CI runs `pnpm test` on every PR. `pnpm test:e2e` runs on PRs targeting `main`
once a disposable Postgres has been stood up.

## Unit Conventions

A unit test should:

- Mount only the class under test plus mocked dependencies
- Use `Test.createTestingModule` so DI wiring matches production
- Mock Prisma with a typed stub (factory, `jest-mock-extended`, or a hand-rolled
  `{ user: { findUnique: jest.fn() }, ... }` object)
- Mock Redis via the real `RedisService` which falls back to an in-memory map
  when `REDIS_URL` is unset — no manual mock needed
- Mock external HTTP with `nock`, scoped to a single `describe` block
- Never touch the real network or disk

Example skeleton:

```ts
import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('accepts a valid HMAC payload', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' } as never);
    await expect(service.verifyTelegram(validPayload))
      .resolves.toEqual(expect.objectContaining({ id: 'u1' }));
  });

  it('rejects an expired auth_date', async () => {
    await expect(service.verifyTelegram(expiredPayload))
      .rejects.toThrow('auth_date expired');
  });
});
```

## E2E Conventions

- Use a **separate test database** — set `DATABASE_URL_TEST=postgres://.../worktime_test`
  in the local `.env.test` and CI secret store
- Reset the DB before each test with either `prisma.$executeRawUnsafe('TRUNCATE ...')`
  or `prisma migrate reset --force --skip-seed`
- Seed only the minimum fixtures for the scenario — shared seed data across
  specs becomes brittle fast
- Use `supertest(app.getHttpServer()).post(...)` so requests flow through the
  real pipe / guard / interceptor stack
- Always `await app.close()` in `afterAll` or the Jest worker will hang

Example:

```ts
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST /auth/telegram (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    applyGlobals(app); // same pipes/filters as main.ts
    await app.init();
  });

  afterAll(() => app.close());

  it('issues a JWT for valid HMAC', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/telegram')
      .send(validPayload)
      .expect(201);
    expect(res.body.accessToken).toMatch(/\./);
  });
});
```

## Coverage Targets

| Layer | Minimum | Stretch |
|-------|---------|---------|
| Statements | 70% | 90% |
| Branches | 60% | 80% |
| Functions | 70% | 90% |
| Critical paths (auth, checkin, analytics) | 90% | 100% |

`collectCoverageFrom` is `src/**/*.ts` minus `src/main.ts`. CI enforces the
minimum thresholds; stretch targets are aspirational for the critical paths.

## Mocking External APIs

- **Telegram Bot API**: import `TelegrafModule.forRoot({ botName: 'test' })` or
  stub `@InjectBot()` with a plain object that records `sendMessage` calls
- **Google Sheets**: stub `SheetsService.getAuthClient` to return a fake
  googleapis client — tests assert on the spreadsheet ops requested, not on
  real network round-trips
- **SMTP**: point `SMTP_HOST=localhost:1025` at a local mailhog (or the
  docker-compose service) and assert via the mailhog JSON API
- **HTTP in general**: `nock('https://host').post('/path').reply(200, body)`
  — activate it in `beforeEach`, `nock.cleanAll()` in `afterEach`

## Current Specs

| File | Purpose |
|------|---------|
| `src/modules/auth/auth.service.spec.ts` | Telegram HMAC verification, JWT issuance, session lookup |
| `src/modules/auth/__tests__/auth.service.spec.ts` | Legacy suite retained during refactor; slated for merge into the co-located file |
| `src/modules/company/company.service.spec.ts` | Tenant creation, membership guards, slug collisions |
| `src/modules/checkin/qr.service.spec.ts` | QR rotation, signature verification, rate limiting |
| `src/modules/analytics/analytics.helpers.spec.ts` | Pure helpers: date bucketing, rate scaling, percentiles |
| `src/modules/project/project.service.spec.ts` | Project CRUD, scope checks against company membership |
| `test/app.e2e-spec.ts` | Smoke E2E — `/healthz`, `/auth/telegram`, happy-path check-in |

New modules should add a co-located spec the moment the service gains its
first branch, not later.

## CI

GitHub Actions runs `pnpm test` on every PR via `.github/workflows/ci.yml`.
The backend job:

1. Boots a Postgres 16 service container
2. Runs `pnpm --filter @worktime/database db:deploy`
3. Runs `pnpm --filter @worktime/api test`
4. On PRs targeting `main`, runs `test:e2e` with `DATABASE_URL_TEST` pointed at
   the service container

Failures block merges. Flaky tests are tracked in GitHub issues labelled
`flaky-test` and must be fixed or quarantined within a week.

## Writing a New Spec — Checklist

1. Co-locate next to source: `src/modules/X/X.service.spec.ts`
2. Import the target from `./X.service` — never reach across modules
3. Mock every DI dependency; assert the service does not try to call real ones
4. Name tests in imperative present tense: `it('rejects expired tokens')`
5. Avoid shared state between `it` blocks — prefer `beforeEach` factories over
   module-level `let` + `beforeAll`
6. One logical assertion per scenario when possible — multiple `expect` calls
   for the same outcome are fine, multiple outcomes per test are not
7. Give fixtures intention-revealing names (`expiredTelegramPayload`, not `p1`)
8. Run the spec in isolation (`jest -t 'rejects expired tokens'`) before
   opening the PR to catch missing mocks that would hide behind earlier tests

## Debugging

- `node --inspect-brk node_modules/.bin/jest --runInBand path/to/spec.ts`
  attaches the Chrome DevTools inspector
- `DEBUG=nestjs*` during `pnpm test:e2e` surfaces Nest lifecycle logs
- `pnpm test --verbose` prints each `it` title — useful when a single file has
  dozens of cases

## Gotchas

- Jest workers hang if a Nest app is created but never `close()`-d — always
  register `afterAll(() => app.close())`
- `ts-jest` in `isolatedModules` mode does not catch cross-file type errors;
  rely on `pnpm build` / `pnpm lint` for that
- `setupFiles` runs once per worker — put environment mutations there, not in
  `beforeEach`, or Jest will silently parallelise them unsafely

# Frontend Testing

This document is the canonical reference for the Next.js frontend's test
suite. It describes the two-layer strategy, the conventions each layer
follows, and the commands used day to day.

Two layers:

1. **Unit / Component** — Vitest + Testing Library running under JSDOM
2. **E2E** — Playwright driving Chromium, Firefox and WebKit against a real
   Next.js dev server

The split is intentional: JSDOM is fast enough to run on every save and covers
pure logic and component behaviour, while Playwright validates real browser
semantics (navigation, cookies, SSE, service workers) that JSDOM cannot.

## Tools

| Tool | Version | Role |
|------|---------|------|
| `vitest` | ^2.1 | Vite-powered test runner with native ESM and TS |
| `@vitejs/plugin-react` | ^4.3 | React SWC transform inside Vitest |
| `vite-tsconfig-paths` | ^5.1 | Resolves `@/*` imports from `tsconfig.json` |
| `@testing-library/react` | ^16 | Component rendering + queries |
| `@testing-library/jest-dom` | ^6.6 | Extra DOM matchers (`toBeInTheDocument`, ...) |
| `@testing-library/user-event` | ^14.5 | Realistic user interaction simulation |
| `jsdom` | ^25 | DOM environment for Vitest |
| `@playwright/test` | ^1.48 | Cross-browser E2E runner |
| `msw` | opt-in | HTTP request mocking for unit + component tests |

## Layout

```
frontend/
├── src/__tests__/*.test.{ts,tsx}      # cross-cutting unit tests
├── src/**/*.test.{ts,tsx}             # co-located component tests
├── vitest.config.mts                  # Vitest runner config (JSDOM)
├── vitest.setup.ts                    # global jest-dom, polyfills
├── e2e/*.spec.ts                      # Playwright specs
├── e2e/fixtures/auth.ts               # authenticated-state fixture
└── playwright.config.ts               # Playwright projects, baseURL, webServer
```

Vitest `include` globs `src/**/*.test.{ts,tsx}`, so both co-located tests next
to the component and suites in `src/__tests__/` are picked up. `tsconfigPaths`
keeps `@/components/...` imports working identically to the app.

## Running

All commands assume `pnpm` and are run from `frontend/`:

| Command | Purpose |
|---------|---------|
| `pnpm test` | Run Vitest once (unit + component) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Vitest with v8 coverage provider |
| `pnpm test:e2e:install` | One-time Playwright browser install (run after clone) |
| `pnpm test:e2e` | Run Playwright across all three projects |
| `pnpm test:e2e:ui` | Playwright interactive UI mode — best for debugging |

Playwright's `webServer.command` is `pnpm dev`, so the suite will boot the app
on port 3000 automatically. Set `E2E_BASE_URL` to skip the auto-boot and run
against an existing server (staging, Docker compose, ...).

## Unit Conventions

A unit / component test should:

- Render with `@testing-library/react`; never reach into React internals
- Query by accessible role or label first, then by text, then by `data-testid`
  (reserve `data-testid` for cases with no natural accessible name)
- Interact via `userEvent` — `fireEvent` bypasses focus and pointer events and
  hides real regressions
- Mock network via MSW handlers in `vitest.setup.ts` so every test sees a
  realistic `fetch` surface
- Keep `vi.mock(...)` calls at the top of the file; `vi.resetAllMocks()` in
  `afterEach` to avoid cross-test bleed

Component example:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeInput } from '@/components/ui/code-input';

it('calls onComplete with 6 digits', async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  render(<CodeInput onComplete={onComplete} />);
  await user.keyboard('123456');
  expect(onComplete).toHaveBeenCalledWith('123456');
});
```

Hook example:

```ts
import { renderHook, act } from '@testing-library/react';
import { useElapsed } from '@/hooks/use-elapsed';

it('ticks once per second', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useElapsed(Date.now()));
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(result.current).toBe(1);
  vi.useRealTimers();
});
```

## E2E Conventions

- Never hard-code production URLs — always use Playwright's `baseURL` from the
  config, which reads `E2E_BASE_URL`
- Use the `auth.ts` fixture for any test that starts logged in; the fixture
  plants a signed cookie directly so the flow under test isn't coupled to the
  login UI
- Mock backend calls with `page.route('**/api/**', route => route.fulfill(...))`
  when the backend is not running in the CI matrix
- Avoid visual snapshots — they're flaky across platforms; assert on visible
  text, roles, and URL changes instead
- Keep specs independent: no shared state, no ordering assumptions, `fullyParallel`
  is on in `playwright.config.ts`

Example:

```ts
import { test, expect } from './fixtures/auth';

test('auth-gated route redirects unauthenticated users', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/dashboard/company/demo');
  await expect(page).toHaveURL(/\/login\?next=/);
});
```

Playwright projects cover Chromium, Firefox and WebKit by default. When a bug
is browser-specific, narrow the run via `pnpm test:e2e --project=webkit`.

## Current Specs

Unit / component (`src/**/*.test.{ts,tsx}`):

| File | Purpose |
|------|---------|
| `src/__tests__/code-input.test.tsx` | Shared CodeInput tests (paste, backspace, completion) |
| `src/__tests__/use-elapsed.test.ts` | `useElapsed` hook — fake-timer tick behaviour |
| `src/__tests__/timer-format.test.ts` | Pure duration formatter (hh:mm:ss edges) |
| `src/__tests__/rate-scale.test.tsx` | Rate-scale rendering across breakpoints |
| `src/components/ui/code-input.test.tsx` | Low-level input keyboard navigation |
| `src/components/office/qr-code.test.tsx` | QR rendering + SVG snapshot-free assertions |
| `src/lib/api.test.ts` | Fetch wrapper — base URL, auth header, error unwrap |
| `src/app/(marketing)/page.test.tsx` | Marketing landing renders heading + CTA |

E2E (`e2e/*.spec.ts`):

| File | Purpose |
|------|---------|
| `e2e/landing.spec.ts` | Marketing page renders across browsers with no console errors |
| `e2e/login.spec.ts` | Telegram login widget mount + redirect handling |
| `e2e/office-qr.spec.ts` | Office QR screen auto-refreshes and falls back when SSE drops |
| `e2e/dashboard-guard.spec.ts` | Unauthenticated visitors bounce to `/login?next=...` |
| `e2e/fixtures/auth.ts` | Shared `test` extension that pre-authenticates via cookie |

Add a spec alongside every new component that holds user-visible state or
non-trivial branching logic.

## Coverage Focus

Vitest `test:coverage` uses the v8 provider. These are the areas we treat as
must-cover — green elsewhere is a bonus:

- Middleware JWT verification (`middleware.ts`) — requires `jose` mocking via
  `vi.mock('jose', ...)` to avoid hitting the KMS during tests
- `CodeInput` interaction (paste of 6-digit codes, partial entry, backspace)
- Timer / elapsed formatting — pure functions, should be 100%
- Auth flow — covered end-to-end in Playwright rather than JSDOM
- Office QR SSE fallback — exercised in Playwright with `page.routeFromHAR` or
  by intercepting the `EventSource` endpoint with `page.route`

## CI

`.github/workflows/ci.yml` defines two frontend jobs:

1. **unit** — runs `pnpm --filter @worktime/web test` on every PR
2. **e2e** — runs `pnpm --filter @worktime/web test:e2e` on PRs targeting
   `main` and on pushes to `main`. The job installs Playwright browsers, boots
   the Next.js dev server via `webServer`, and uploads `playwright-report/` as
   a build artifact on failure

Retries are enabled only in CI (`retries: 2`) and `trace: 'on-first-retry'` so
that the first failure is captured without the overhead on green runs.

## Writing a New Test — Checklist

1. Co-locate with the component when it's component-specific, otherwise put it
   under `src/__tests__/` when it spans multiple modules
2. Use accessible queries (`getByRole`, `getByLabelText`) — if you can't find
   the element that way, the component probably has an accessibility bug
3. Prefer `userEvent` over `fireEvent`
4. Use `screen.findBy*` for async-appearing elements rather than manual `await`
5. Avoid `act(...)` unless absolutely needed — Testing Library wraps it for you
6. Keep snapshots minimal and human-readable; large JSON snapshots are a smell
7. For Playwright, assert on the URL and visible content first; inspect the
   DOM only when the user-visible signal is insufficient

## Debugging

- `pnpm test:watch` + Vitest's "u" key to update inline snapshots
- `pnpm test:e2e:ui` gives a time-travel debugger for Playwright traces
- `PWDEBUG=1 pnpm test:e2e` drops into the Playwright inspector
- `DEBUG=pw:api pnpm test:e2e` logs every Playwright API call
- Run a single file with `pnpm test src/__tests__/code-input.test.tsx` or
  `pnpm test:e2e e2e/login.spec.ts`

## Gotchas

- Vitest runs under JSDOM — `ResizeObserver`, `IntersectionObserver`, `matchMedia`,
  and `scrollTo` are all shimmed in `vitest.setup.ts`. Add new polyfills there,
  not inside individual tests
- JSDOM does not implement layout; tests that assert on pixel measurements
  should move to Playwright
- Playwright's `webServer` reuses the existing dev server when running locally
  (`reuseExistingServer: !process.env.CI`) — if the server is in a bad state,
  kill it manually before re-running
- React Server Components that touch server-only APIs (`cookies()`, `headers()`)
  cannot be rendered in JSDOM; test those via Playwright or extract the pure
  parts into a client component helper

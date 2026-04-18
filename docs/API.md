# Work Tact API Reference

Base URL (local): `http://localhost:4000/api`
Base URL (prod):  `https://api.your-domain.kz/api`
Interactive docs: `GET /api/docs` (Swagger UI)

**Authentication**: Bearer JWT in `Authorization: Bearer <token>`. Obtain via `/auth/telegram/bot-login` or `/auth/telegram/verify`. Refresh via `/auth/refresh`.

**Rate Limits**: A global 60 req/min per user envelope is applied via `@nestjs/throttler`. Tighter per-route buckets override the default:

| Bucket            | Limit        | Endpoints                                               |
|-------------------|--------------|---------------------------------------------------------|
| AUTH.botLogin     | 5 / 60s      | `POST /auth/telegram/verify`, `POST /auth/telegram/bot-login` |
| CHECKIN_SCAN      | 20 / 60s     | `POST /checkin/scan`                                    |
| SHEETS_EXPORT     | 3 / 60s      | `POST /sheets/export/company/:companyId/monthly`        |
| TELEGRAM_INVITE   | 30 / 3600s   | `POST /companies/:id/employees/invite`                  |

All timestamps are ISO-8601 UTC (`2026-04-17T12:00:00Z`). All monetary values are decimals encoded as strings to avoid float drift. Monthly aggregation endpoints accept a `month` query parameter in the `YYYY-MM` form.

---

## Auth

All auth routes live under `/auth`. Verify and bot-login are `@Public` — they short-circuit the global JwtAuthGuard via the `IS_PUBLIC_KEY` reflector metadata.

### POST `/auth/telegram/verify`
- **Auth**: Public
- **Body**:
  ```ts
  { initData: string }  // raw Telegram Mini App initData query-string
  ```
- **Response 200**:
  ```ts
  { accessToken: string; refreshToken: string; expiresIn: number }
  ```
- **Errors**: `401 invalid Telegram signature`, `401 auth_date expired`
- **Notes**: Validates the Telegram WebApp HMAC, upserts the user row, and issues a token pair bound to `user.id`.

```bash
curl -X POST https://api.your-domain.kz/api/auth/telegram/verify \
  -H "Content-Type: application/json" \
  -d '{"initData":"query_id=AAH...&user=%7B%22id%22%3A12345%7D&auth_date=1713350400&hash=deadbeef"}'
```

### POST `/auth/telegram/bot-login`
- **Auth**: Public
- **Body**:
  ```ts
  { userId: string /* cuid */; oneTimeCode: string /* /^\d{6}$/ */ }
  ```
- **Response 200**: token pair (same shape as `/verify`).
- **Errors**: `401 Invalid or expired one-time code`, `401 User mismatch`

### POST `/auth/refresh`
- **Auth**: Public (token-bound)
- **Body**: `{ refreshToken: string }`
- **Response 200**: new token pair.
- **Errors**: `401 Refresh token invalid or revoked`.

### GET `/auth/me`
- **Auth**: Bearer JWT (`AuthGuard('jwt')`)
- **Response 200**:
  ```ts
  {
    id: string;
    telegramId: string;     // bigint stringified
    firstName: string;
    lastName: string | null;
    username: string | null;
    phone: string | null;
    avatarUrl: string | null;
  }
  ```
- **Errors**: `401` if the JWT is missing or the user was deleted.

---

## Companies

All `/companies` routes require JWT (applied globally) and are gated by `CompanyRoleGuard` for role-scoped handlers. `@RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)` is used where noted.

### POST `/companies`
- **Auth**: Bearer JWT
- **Body**: `CreateCompanyDto` from `@worktime/types` — at minimum `{ name: string; slug: string; timezone: string; ... }`.
- **Response 201**: created `Company` row. Caller becomes the OWNER.
- **Errors**: `400 validation error`.

### GET `/companies/my`
- **Auth**: Bearer JWT
- **Response 200**: `Array<{ id; name; slug; role; memberCount; ... }>` — one entry per company the caller belongs to.

### GET `/companies/:slug`
- **Auth**: Bearer JWT + must be an employee of the slug
- **Path params**: `slug` — company slug
- **Response 200**: `Company`
- **Errors**: `403 Caller is not an employee`, `404 Company not found`.

### PATCH `/companies/:id`
- **Auth**: OWNER or MANAGER
- **Path params**: `id` — company id
- **Body**: `UpdateCompanyDto` — any subset of the company mutable fields (name, timezone, workingHours, policies, …).
- **Response 200**: updated `Company`.
- **Errors**: `403 Insufficient role`.

### POST `/companies/:id/employees/invite`
- **Auth**: OWNER or MANAGER
- **Rate limit**: `TELEGRAM_INVITE` (30 / 1h)
- **Body**: `InviteEmployeeDto` — `{ firstName, lastName?, role, position?, monthlySalary?, hourlyRate? }`.
- **Response 201**:
  ```ts
  { inviteUrl: string; token: string; expiresAt: string }
  ```
  `inviteUrl` is a `https://t.me/<bot>?start=INV_...` deep-link.

### GET `/companies/:id/employees`
- **Auth**: OWNER or MANAGER
- **Response 200**: `Array<Employee>` (joined with `User`).

### PATCH `/companies/:id/employees/:employeeId`
- **Auth**: OWNER or MANAGER
- **Body**:
  ```ts
  {
    position?: string;
    monthlySalary?: number | null;
    hourlyRate?: number | null;
    role?: 'OWNER' | 'MANAGER' | 'EMPLOYEE';
  }
  ```
- **Response 200**: updated `Employee`.

### DELETE `/companies/:id/employees/:employeeId`
- **Auth**: OWNER only
- **Response 200**: `{ ok: true, status: 'INACTIVE' }` — soft-delete.

```bash
curl -X POST https://api.your-domain.kz/api/companies/cmp_abc/employees/invite \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Aida","role":"EMPLOYEE","monthlySalary":450000}'
```

---

## Employees

Routes under `/employees`. All protected by `AuthGuard('jwt')`.

### GET `/employees/me`
- **Response 200**: `Array<Employee>` — one per company the caller belongs to.

### GET `/employees/me/:companyId`
- **Response 200**: caller's own `Employee` row for a given company, enriched with derived monthly stats (`hoursThisMonth`, `lateDays`, `earnings`).
- **Errors**: `404` if the caller has no employee row in that company.

### POST `/employees/accept-invite`
- **Body**: `{ token: string }`
- **Response 201**: the newly created enriched employee record (same shape as `GET /employees/me/:companyId`).
- **Errors**: `401 Invite token is invalid or expired`.

### GET `/employees/:employeeId`
- **Auth**: caller must be OWNER/MANAGER in the same company (enforced inside the service).
- **Response 200**: full `Employee` + derived admin metrics.

```bash
curl -X POST https://api.your-domain.kz/api/employees/accept-invite \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"token":"INV_01HY..."}'
```

---

## Check-in

Routes under `/checkin`. Mixes JWT-protected employee routes with `@Public()` display-facing endpoints that accept either an `X-Display-Key` header or a Bearer JWT (verified manually inside the controller).

### POST `/checkin/scan`
- **Auth**: Bearer JWT
- **Rate limit**: `CHECKIN_SCAN` (20 / 60s)
- **Body** (`ScanQrDto`):
  ```ts
  {
    token: string;          // rotating QR token
    latitude?: number;      // -90..90
    longitude?: number;     // -180..180
  }
  ```
- **Response 201**:
  ```ts
  { id: string; employeeId: string; type: 'IN' | 'OUT'; createdAt: string; isLate: boolean }
  ```
- **Errors**: `400 Invalid or expired token`, `401`.

### GET `/checkin/qr/:companyId/current`
- **Auth**: `X-Display-Key` header OR Bearer JWT of an employee of that company.
- **Path params**: `companyId`
- **Response 200**:
  ```ts
  { token: string; expiresAt: string; rotationInSec: number }
  ```
- **Errors**: `401 Display key or employee JWT required for this company`.

### GET `/checkin/qr/:companyId/stream`
- See [WebSocket / SSE](#websocket--sse).

### GET `/checkin/history?companyId=...`
- **Auth**: Bearer JWT
- **Query**: `companyId` (required)
- **Response 200**: caller's check-ins for the current month, sorted `createdAt` desc.
- **Errors**: `400 companyId query parameter is required`.

### POST `/checkin/manual`
- **Auth**: Bearer JWT + caller must be OWNER/MANAGER in the target employee's company.
- **Body** (`ManualCheckinDto`):
  ```ts
  {
    employeeId: string;
    type: 'IN' | 'OUT';
    timestamp?: string;     // ISO; defaults to now()
    reason?: string;        // <= 500 chars, logged only
  }
  ```
- **Response 201**: the created `CheckIn`.
- **Errors**: `400 employeeId does not exist`, `403 You are not a member of that company`.

```bash
curl -X POST https://api.your-domain.kz/api/checkin/scan \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"token":"qr_01HY...","latitude":43.238,"longitude":76.889}'
```

---

## Projects (B2C)

All `/projects` routes require JWT. Ownership is enforced service-side — a caller can only see their own projects.

### POST `/projects`
- **Body**: `CreateProjectDto` — `{ name, clientName?, hourlyRate?, fixedPrice?, currency, color? }`.
- **Response 201**: `Project`.

### GET `/projects`
- **Response 200**: `Array<Project>` for the caller.

### GET `/projects/:id`
- **Response 200**: `Project` with embedded `stats` (total hours, earnings MTD).
- **Errors**: `404 Project not found or not owned`.

### PATCH `/projects/:id`
- **Body**: `UpdateProjectDto` — partial.
- **Response 200**: updated `Project`.

### DELETE `/projects/:id?force=true|false`
- **Query**: `force` — if `true`, hard-delete even when time entries exist; otherwise soft-archive.
- **Response 200**: `{ id, archived: boolean, deleted: boolean }`.

### GET `/projects/:id/monthly-summary?month=YYYY-MM`
- **Response 200**:
  ```ts
  {
    month: string;           // YYYY-MM
    totalMinutes: number;
    billableMinutes: number;
    earnings: string;        // decimal string
    currency: string;
    entries: number;
  }
  ```
- **Errors**: `400 month query param required, format YYYY-MM`.

```bash
curl -X GET "https://api.your-domain.kz/api/projects/prj_abc/monthly-summary?month=2026-04" \
  -H "Authorization: Bearer $JWT"
```

---

## Time Entries (B2C)

All `/time-entries` routes require JWT. Ownership of the owning project is checked in the service.

### POST `/time-entries/start`
- **Body**: `{ projectId: string }`
- **Response 200**: the new active `TimeEntry` row.
- **Errors**: `409 Another timer is already running`.

### POST `/time-entries/:id/stop`
- **Response 200**: the finalised entry with `endedAt` and `durationSec`.
- **Errors**: `404 Entry not found or not owned`.

### GET `/time-entries/active`
- **Response 200**: active `TimeEntry` or `null`.

### GET `/time-entries?projectId=&from=&to=`
- **Query**: `projectId?`, `from?` (ISO), `to?` (ISO). All optional.
- **Response 200**: `Array<TimeEntry>` sorted by `startedAt` desc.

### POST `/time-entries/manual`
- **Body** (`ManualEntryDto`):
  ```ts
  {
    projectId: string;
    startedAt: string;     // ISO
    endedAt: string;       // ISO, must be > startedAt
    note?: string;         // <= 5000 chars
  }
  ```
- **Response 201**: created entry.
- **Errors**: `400 startedAt must be before endedAt`.

### DELETE `/time-entries/:id`
- **Response 200**: `{ ok: true }`.

---

## Analytics

All `/analytics` routes require JWT. Company-scoped routes additionally require `CompanyAdminGuard` (caller is OWNER/MANAGER in `:companyId`).

### GET `/analytics/company/:companyId/late-stats?month=YYYY-MM`
- **Auth**: company admin
- **Response 200**:
  ```ts
  Array<{ employeeId; fullName; lateDays: number; totalLateMinutes: number }>
  ```

### GET `/analytics/company/:companyId/ranking?month=YYYY-MM&limit=10`
- **Auth**: company admin
- **Query**: `month` (req), `limit` (default 10)
- **Response 200**: `Array<{ employeeId; fullName; hours: number }>` top-N by worked hours.

### GET `/analytics/company/:companyId/overtime?month=YYYY-MM`
- **Auth**: company admin
- **Response 200**: `Array<{ employeeId; overtimeHours: number }>`.

### GET `/analytics/company/:companyId/summary?month=YYYY-MM`
- **Auth**: company admin
- **Response 200**:
  ```ts
  {
    month: string;
    totalEmployees: number;
    totalHours: number;
    avgLateMinutes: number;
    overtimeHours: number;
    payrollTotal: string;    // decimal string
  }
  ```

### GET `/analytics/user/real-hourly-rate?month=YYYY-MM`
- **Auth**: JWT (caller)
- **Response 200**: `{ month; workedHours; earnings; realRate: string; currency }`.

### GET `/analytics/user/project/:projectId/rate-history?months=6`
- **Auth**: JWT (caller + project ownership)
- **Query**: `months` — default 6
- **Response 200**: `Array<{ month; rate: string; hours: number }>` (oldest first).

---

## Sheets

All `/sheets` routes require JWT. Only OWNER/MANAGER may trigger an export (enforced in the service via company membership lookup).

### POST `/sheets/export/company/:companyId/monthly`
- **Rate limit**: `SHEETS_EXPORT` (3 / 60s)
- **Body**: `{ month: string /* YYYY-MM */ }`.
- **Response 200**:
  ```ts
  {
    spreadsheetId: string;
    spreadsheetUrl: string;
    tabName: string;
    rowsWritten: number;
    reused: boolean;     // true if an existing spreadsheet was reused
  }
  ```
- **Errors**: `400 invalid month payload`, `403 Insufficient role`.

### GET `/sheets/company/:companyId/link`
- **Response 200**:
  ```ts
  { spreadsheetId: string; spreadsheetUrl: string; createdAt: string }
  ```
- **Errors**: `404 No spreadsheet has been created for this company yet`.

```bash
curl -X POST https://api.your-domain.kz/api/sheets/export/company/cmp_abc/monthly \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"month":"2026-04"}'
```

---

## Reports (PDF)

All `/reports` routes require JWT. The response is a streamed PDF, `Content-Type: application/pdf`, `Content-Disposition: attachment`, `Cache-Control: private, no-store`.

### GET `/reports/company/:companyId/attendance.pdf?month=YYYY-MM`
- **Auth**: `CompanyAdminGuard` (OWNER/MANAGER of `:companyId`)
- **Query**: `month` (required, YYYY-MM)
- **Response 200**: binary PDF stream. Filename: `attendance-<companyId>-<month>.pdf`.
- **Errors**: `400 month must be YYYY-MM`, `403 Not a company admin`.

### GET `/reports/user/invoice.pdf?month=YYYY-MM&projectId=...`
- **Auth**: JWT (caller); request is always scoped to the caller's own data.
- **Query**: `month` (required), `projectId` (optional; narrows to a single project).
- **Response 200**: binary PDF stream. Filename: `invoice-<month>[-<projectId>].pdf`.

```bash
curl -L -X GET "https://api.your-domain.kz/api/reports/user/invoice.pdf?month=2026-04" \
  -H "Authorization: Bearer $JWT" \
  --output invoice-2026-04.pdf
```

---

## Notifications (internal only)

`/modules/notification` exposes no HTTP controller — it is consumed in-process by other services (Auth, Company, Sheets) through `NotificationService`. Payload shapes live in `src/modules/notification/dto/*.ts` (`SendEmployeeInviteDto`, `SendMonthlyReportReadyDto`, `SendAuthLinkDto`) and are delivered via the Telegram bot transport. Not part of the public API surface.

---

## Admin (platform super-admin)

All `/admin` routes are gated by `JwtAuthGuard` + `SuperAdminGuard` (caller's telegramId must appear in the `SUPER_ADMIN_TELEGRAM_IDS` env list).

### GET `/admin/stats`
- **Response 200**:
  ```ts
  {
    companies: number;
    users: number;
    employees: number;
    checkInsToday: number;
    activeSubscriptions: number;
  }
  ```

### GET `/admin/companies?limit=25&cursor=<id>&q=<search>`
- **Query**: `limit` (default 25), `cursor` (opaque — an id), `q` (matches name/slug).
- **Response 200**:
  ```ts
  {
    items: Array<{ id; name; slug; ownerId; tier; employees: number; createdAt }>;
    nextCursor: string | null;
  }
  ```

### GET `/admin/companies/:id`
- **Response 200**: full `Company` with owner, employee roster, subscription, and recent billing events.

### POST `/admin/companies/:id/deactivate`
- **Response 200**: `{ ok: true, deactivated: number }` — soft-deactivates every employee.

### GET `/admin/users?telegramId=&phone=`
- **Query**: `telegramId` or `phone` (partial).
- **Response 200**: `Array<User>`.

---

## Billing

All `/billing` routes require JWT except the provider webhook.

### GET `/billing/my/:companyId`
- **Auth**: the company owner only (checked against `Company.ownerId`).
- **Response 200**:
  ```ts
  {
    subscription: Subscription | null;
    tier: 'FREE' | 'PRO' | 'BUSINESS' | ...;
    limits: { employees: number; exportsPerMonth: number; ... };
  }
  ```
- **Errors**: `403 Only the company owner may view billing`, `404 Company not found`.

### POST `/billing/checkout`
- **Auth**: company owner
- **Body**: `{ companyId: string; tier: SubscriptionTier }`
- **Response 200**: `{ checkoutUrl: string; external: boolean }`.
- **Notes**: Current implementation returns a stub URL; YooKassa/Stripe integration is tracked inline in the controller TODOs.

### POST `/billing/webhook`
- **Auth**: Public (HMAC verification to be added).
- **Body**: opaque provider payload.
- **Response 200**: `{ received: true }`.

---

## Health / Liveness / Readiness

Under the root controller (no prefix override). All marked `@Public`.

### GET `/health`
- **Response 200**:
  ```ts
  { status: 'ok'; version: string; uptime: number; timestamp: string }
  ```

### GET `/healthz/live`
- Kubernetes liveness probe.
- **Response 200**: `{ status: 'ok'; uptime; timestamp }`.

### GET `/healthz/ready`
- Kubernetes readiness probe. Pings Prisma (1.5s timeout) and Redis when configured (1s timeout) via `@nestjs/terminus`.
- **Response 200**: standard Terminus shape:
  ```json
  { "status": "ok", "info": { "database": { "status": "up" } }, "error": {}, "details": { ... } }
  ```
- **Response 503**: when any indicator is down — Terminus sets `status: 'error'` and non-empty `error` map.

### GET `/metrics`
- Prometheus scrape endpoint (plain text, `text/plain; version=0.0.4`).
- Gated by `METRICS_TOKEN` if that env var is set (`Authorization: Bearer <token>`).

---

## WebSocket / SSE

### GET `/checkin/qr/:companyId/stream`
- **Transport**: Server-Sent Events (`text/event-stream`), implemented via Nest's `@Sse`.
- **Auth**: `X-Display-Key` header OR Bearer JWT of an employee of `:companyId`. The route is `@Public()` so the JwtAuthGuard is bypassed; the controller verifies the token manually using `JwtService` with `JWT_ACCESS_SECRET`, then confirms employee membership via Prisma.
- **Event payload** (default `message` event):
  ```json
  { "token": "qr_01HY...", "expiresAt": "2026-04-17T12:00:30Z", "rotationInSec": 30 }
  ```
  Emits the current token immediately on connect (primed via `QrService.currentForCompany`) and every subsequent rotation.
- **Heartbeat**: a named `ping` event every 10s keeps proxies from idling the connection:
  ```
  event: ping
  data: { "t": 1713350400000 }
  ```
- **Example** (browser):
  ```js
  const src = new EventSource(
    'https://api.your-domain.kz/api/checkin/qr/cmp_abc/stream',
    { withCredentials: false },
  );
  // display-key auth via header is not available in EventSource; use a JWT
  // query fallback (reverse-proxied to an Authorization header) or set up
  // the display key server-side.
  src.addEventListener('message', (e) => {
    const { token, expiresAt } = JSON.parse(e.data);
    render(token, new Date(expiresAt));
  });
  src.addEventListener('ping', () => { /* liveness */ });
  src.onerror = () => { /* auto-reconnects */ };
  ```
- **Example** (curl, display key):
  ```bash
  curl -N https://api.your-domain.kz/api/checkin/qr/cmp_abc/stream \
    -H "X-Display-Key: $DISPLAY_KEY"
  ```

There are no true WebSocket endpoints; SSE is preferred for the office-display fan-out because it trivially traverses HTTP caches and reconnects for free.

---

## Error Shape

All unhandled exceptions pass through a global filter that normalises the body to:

```json
{
  "statusCode": 400,
  "message": "month must be YYYY-MM",
  "path": "/api/analytics/company/cmp_abc/summary",
  "timestamp": "2026-04-17T12:00:00Z"
}
```

Validation errors from `ZodValidationPipe` include a `details` array with the individual Zod issues. Auth errors always use `401`; authorization (role) errors always use `403`.

---

## Pagination

Admin listings use cursor-based pagination:

```
GET /admin/companies?limit=20&cursor=<opaqueId>
```

- `limit` — default 25, clamped to [1, 100].
- `cursor` — `null`/absent on first page; pass back the previous `nextCursor` to advance.
- Response:
  ```ts
  { items: T[]; nextCursor: string | null }
  ```

Non-admin listings (`/companies/my`, `/projects`, `/time-entries`) are unpaginated — we rely on the fact that a single user rarely has more than a few hundred rows, and the UI-side filters cover the rest. If that assumption breaks, switch to the same cursor contract.

---

## Conventions Summary

- **Method semantics**: `POST` creates (or triggers actions), `PATCH` partial-updates, `PUT` is not used, `DELETE` soft-deletes where feasible with a `?force=true` escape hatch on `/projects/:id`.
- **IDs**: cuid-style strings. Telegram IDs are bigints serialised as strings.
- **Money**: always decimal-as-string, currency code in a sibling field.
- **Dates**: ISO-8601 UTC on input and output; `month` params are `YYYY-MM`.
- **Auth propagation**: `JwtAuthGuard` is registered globally; individual routes opt out with `@Public()`. Role guards (`CompanyRoleGuard`, `CompanyAdminGuard`, `SuperAdminGuard`) stack on top of JWT.
- **Throttler**: the `ThrottlerModule` default bucket is 60 req/min per user (IP fallback). Named buckets in `src/common/throttle/throttle.constants.ts` override per route via the `@Throttle()` decorator.

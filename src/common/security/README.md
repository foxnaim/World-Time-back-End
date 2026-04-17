# `common/security`

Security primitives for the WorkTime API. Everything in this folder is
**defense-in-depth** — the layers above (nginx, Next.js CSP, Nest guards,
zod schemas) do the primary work. These helpers exist to close gaps and to
make the security posture explicit in code review.

## Files

| File | Purpose | Wired in? |
| --- | --- | --- |
| `helmet.config.ts` | HTTP hardening headers (HSTS, frameguard, nosniff, referrer policy) | Yes — `main.ts` applies it early in the middleware chain. |
| `sanitize.ts` | Free-text sanitization helpers (strip control chars, clamp length) | No — opt-in per controller. |
| `README.md` | This file. | — |

## How to think about a new input

When you add a new endpoint or DTO, walk through the layers in order:

1. **Authentication.** Is the route public? If not, attach `@UseGuards(JwtAuthGuard)`
   (or the appropriate guard) at the controller or handler. Public routes
   must be marked explicitly — never rely on "I forgot to add a guard" as
   a negative signal.

2. **Authorization.** Does the caller have permission to touch *this*
   specific resource? Role checks happen in guards; row-level checks
   (e.g. "this booking belongs to this tenant") happen in the service,
   never in the controller.

3. **Validation.** Every DTO is a zod schema consumed via `nestjs-zod`.
   The schema is the *single source of truth* for shape, types, bounds,
   and format. Reject on the schema — do not validate by hand in the
   service. If you find yourself reaching for `class-validator` on a new
   endpoint, stop and add a zod schema instead.

4. **Sanitization (optional).** Apply helpers from `sanitize.ts` only
   when:
   - The field is genuinely free-text (notes, descriptions, display
     names) AND
   - The value is rendered somewhere that cares about control
     characters, length, or whitespace (Telegram messages, logs, CSV
     exports, printed receipts).

   For strictly-formatted fields (emails, phone numbers, UUIDs, tokens),
   **do not sanitize** — validate hard in zod and reject invalid input
   outright. Sanitizing a malformed UUID hides a bug rather than fixing
   it.

5. **Rate limiting.** Mutating endpoints and anything that touches an
   external service (Telegram, email, SMS) should have a throttler
   applied. See `common/throttler`.

6. **Audit logging.** Admin mutations, auth events, and anything that
   changes permissions should produce an audit-log entry in the service.
   Do not log PII into the request logger — the pino logger is for
   operational telemetry, not compliance trails.

## Where sanitization belongs

Apply in the **service**, not the controller. The controller's job is to
hand a typed DTO to the service; sanitization transforms that DTO before
persistence or external I/O. Doing it in the controller couples the HTTP
layer to business rules and makes it easy to forget when an internal
caller invokes the service directly.

```ts
// bad: controller does both
@Post()
create(@Body() dto: CreateNoteDto) {
  return this.svc.create({ ...dto, body: sanitizeString(dto.body) });
}

// good: service owns it
async create(dto: CreateNoteDto) {
  const body = sanitizeString(dto.body, { maxLength: 5_000 });
  return this.repo.insert({ ...dto, body });
}
```

## What this folder is **not** for

- SQL injection defense — that's Prisma's job, and it does it well. Do
  not hand-roll escaping.
- Password hashing — use the auth module's existing argon2 wrapper.
- CSRF — we use SameSite=Lax cookies plus the `Authorization` header
  pattern; there is no session form-POST surface that would need a CSRF
  token.
- CSP — lives at the nginx and Next.js layer. Do not try to set CSP from
  Nest.

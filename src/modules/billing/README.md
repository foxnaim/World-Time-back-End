# Billing Module

Subscription tiers, seat enforcement, and payment-provider stubs.

## Tier matrix

| Tier       | Seats  | Monthly reports | Sheets export | Custom branding | Price / seat (RUB) |
|------------|--------|-----------------|---------------|-----------------|--------------------|
| FREE       | 5      | yes             | no            | no              | 0                  |
| TEAM       | 100    | yes             | yes           | no              | 200                |
| ENTERPRISE | 10 000 | yes             | yes           | yes             | contact sales      |

Source of truth: `tier-config.ts`. The `Subscription.seatsLimit` column is seeded from this matrix but can be overridden per company (e.g. custom ENTERPRISE deals).

## How enforcement works

- `SeatLimitGuard` calls `BillingService.checkSeatAvailable(companyId)` before an invite is issued. It throws `ForbiddenException` with the message "Достигнут лимит сотрудников на текущем тарифе" once active employees >= `seatsLimit`.
- Wire it on the invite route in `company.controller.ts` (left to agent 34 to avoid merge conflicts):
  ```ts
  @UseGuards(CompanyRoleGuard, SeatLimitGuard)
  @Post(':id/employees/invite')
  ```
- `CompanyService.create` should call `BillingService.createDefaultFreeSubscription(companyId)` right after inserting the Company row. TODO: wire this up when CompanyService is next touched.

## Webhook integration plan

`POST /billing/webhook` is `@Public()` and currently just logs + 200s so the provider does not retry during development. To promote it:

1. Verify the HMAC signature header (Stripe `Stripe-Signature`, YooKassa `Idempotence-Key` + body HMAC).
2. Parse event type — map `payment.succeeded` -> `status = ACTIVE`, `subscription.canceled` -> `CANCELED`, `invoice.payment_failed` -> `PAST_DUE`.
3. Advance `currentPeriodEnd` and persist `externalId`.
4. Make idempotent via `(externalId, event.id)` uniqueness.

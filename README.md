# 224 Live House

Private event venue reservation engine and initial customer booking UI.

## Implemented

- Vinext/Vite, React and TypeScript application scaffold.
- PostgreSQL database and Drizzle connection; explicit parameterized SQL for critical transactions.
- Space allocations with database exclusion constraints, including setup/cleanup buffers.
- Two-hour minimum and whole-hour OT with server-calculated integer-satang quotes.
- Weekly hours, special-date overrides, blackouts and overnight date handling.
- Per-unit equipment inventory and concierge shifts, atomically reserved with the space.
- Idempotent holds and sandbox checkout, signed sandbox event validation, event deduplication and transactional notification outbox.
- Pending extensions with separate adjustment checkout; original confirmed end remains unchanged until verified payment.
- Expired extensions restore original allocations without removing the paid booking.
- Customer booking form, quote summary, sandbox payment page and secure browser-scoped booking status.
- Protected development administration APIs for spaces, services, resources, blackouts and expiry.

This is an initial **development build**, not a production-ready deployment. No genuine rates or provider credentials are supplied.

## Local setup

Requires Node >=22.13 and PostgreSQL with permission to install btree_gist.

1. Install dependencies: npm ci.
2. Create a dedicated development database. Set DATABASE_URL in the server environment.
3. Apply migrations: npm run db:migrate.
4. Optional development fixtures: set ALLOW_DEMO_SEED=yes and run npm run db:demo once on an empty development database. All fixture prices/policies are illustrative.
5. Copy .env.example to .env.local. Set DATABASE_URL, APP_ORIGIN=http://localhost:5173 and PAYMENT_MODE=sandbox.
6. For development admin APIs, generate a random ADMIN_API_TOKEN of at least 32 characters. Use Authorization: Bearer <token> with the API. This is a temporary development access mechanism, not individual staff authentication.
7. Run npm run dev. Browse localhost:5173. Create a booking and simulate payment; no money is collected.

CLI scripts read exported environment variables, not .env.local automatically. Vite reads the listed server variables from .env.local for the app.

The sandbox is disabled when NODE_ENV=production. Production APIs fail closed with production_not_configured. Do not remove this gate to launch.

## Resource model

Each space, equipment unit or concierge person has a resource_units row. Active allocations use half-open timestamptz ranges. An exclusion constraint rejects overlaps for a unit even if a writer bypasses the application.

Inventory capacity is the number of active units in a pool. This first build allocates individually represented stock rather than summed arbitrary pools. A booking transaction locks the required pools in sorted order and reserves all units or rolls everything back.

Concierge shifts must cover the entire requested service window. Services cover the full event at launch; custom coverage windows are a later UI/domain enhancement. Service preparation/cleanup adds sequentially to venue buffers, conservatively protecting capacity.

Overnight hours use local minute windows with end up to 2880 (next-day midnight). A special-date override replaces all opening segments on that civil date, including inherited overnight segments. Setup and cleanup must fit opening hours in this build.

## Payment and extension behavior

Only the development sandbox adapter is implemented. It creates local checkout URLs with immutable expected amounts. Provider integration must verify raw signatures, account/environment, exact amount/currency/session/quote linkage, and reconcile uncertain results.

Pending extensions expand existing resource allocations to the union of the original and proposed time. They never bypass the exclusion constraint and never alter the confirmed event end before payment. Full-event service coverage extends together. Hour-priced services add incremental hours; per-unit/fixed services do not automatically add another fee.

Sandbox expiry can release unpaid reservations because no external bank/provider processing exists. Run npm run db:expire periodically during development, or POST /api/admin/expire. Do not use this expiry mechanism for live payments without provider cancellation/reconciliation.

Late paid events after released capacity enter manual review. They never overbook. Outbox entries are persisted, but email delivery, retries and operational exception resolution are not yet wired.

Customer access uses random 32-byte tokens, SHA-256 digests in the database, and HttpOnly SameSite cookies. Token redemption by emailed links and account recovery are not implemented. The browser cookie expires after seven days.

## API

| Method | Route |
| --- | --- |
| GET | /api/catalog |
| GET | /api/availability?spaceId=studio&date=YYYY-MM-DD&hours=2&guests=1 |
| POST | /api/quotes |
| POST | /api/bookings/holds |
| GET | /api/bookings/{id}/status |
| POST | /api/bookings/{id}/checkout |
| POST | /api/bookings/{id}/extensions |
| GET | /api/sandbox/{paymentId}/summary |
| POST | /api/sandbox/{paymentId}/settle |
| POST | /api/payments/webhook/sandbox |
| GET | /api/admin/bookings |
| POST | /api/admin/spaces |
| POST | /api/admin/services |
| POST | /api/admin/resources |
| POST | /api/admin/blackouts |
| POST | /api/admin/expire |

Browser mutations require application Origin and application/json. Holds/checkouts/extensions require an Idempotency-Key. Status and customer mutation routes require the matching cookie or X-Booking-Token header. Webhook signature header is X-Sandbox-Signature, HMAC-SHA256 of the exact raw body with SANDBOX_WEBHOOK_SECRET.

No quote reserves capacity. Holding is the authoritative revalidation step. Catalog edits change quote digests and invalidate old unpaid selections.

## Verification

- npm run typecheck
- npm test
- npm run build

Local tests use PGlite (actual PostgreSQL SQL in WASM) through a serialized test pool. These validate SQL constraints, rollback and domain/payment behavior, but are **not evidence of native multi-backend locking correctness**.

GitHub CI runs the same suite with independent connections to a PostgreSQL 17 service. Set TEST_DATABASE_URL to a database whose name ends in _test to run that suite locally. Tests truncate this dedicated database; never point it at customer data.

## Next production gates

- Select/provision managed PostgreSQL and Cloudflare deployment/Hyperdrive; test the actual Workers connection/runtime and disable authoritative-query caching.
- Integrate a selected hosted payment provider, reconciliation, refunds and recovery.
- Replace development admin token with individual accounts, roles, MFA and revocable sessions; add rate limits.
- Configure approved venue rates, hours, media, privacy/cancellation/payment policies.
- Build the operational admin calendar/settings/exception UI.
- Add media uploads/video cards, custom concierge coverage, receipts and notification delivery jobs.
- Complete browser/mobile/accessibility checks. Native PostgreSQL CI passes; keep that gate enabled.
- Resolve or assess remaining Vinext transitive dependency audit findings before production (see docs/BUILD_STATUS.md).

No Cloudflare worker, database account or live site has been provisioned by this commit. The UI currently uses generated service placeholders until genuine images are supplied.

See docs/SPACE_BOOKING_IMPLEMENTATION_PLAN.md and docs/VENUE_ENGINE_PHASED_BUILD.md for the full product scope.

## Separate Cloudflare site

Worker target: `224-live-house`. See [Cloudflare deployment](docs/CLOUDFLARE_DEPLOYMENT.md) for publishing instructions. `npm run build:cloudflare` creates the Worker bundle. The initial public deployment keeps real booking/payment APIs disabled pending production configuration.

### Schedule administration

Open `/admin` in the development sandbox and connect using the configured development admin token. Edit weekday windows (including next-day closing), add date overrides, inspect buffered occupied intervals, and create/release blackout periods. Reload saved hours after a stale-revision error. Saving hours preserves current prices and existing bookings; affected booking codes are reported for manager review. Production access remains disabled until the database and individual MFA-protected admin accounts are integrated. See `docs/BUILD_STATUS.md` for remaining operations work.

# Initial venue-engine build status

2026-10-09

| Phase | Delivered in this build | Still required |
| --- | --- | --- |
| 1 | Schema, buffers, exclusion constraints, transactional allocations | Provision live DB |
| 2 | Weekly/special hours, overnight handling, audited blackout creation/release, schedule revision protection and responsive development admin UI | Owner settings, production staff authentication and live database |
| 3 | 2-hour base + hourly OT, satang quotes and configuration API | Actual rates, advanced taxes/discounts and expiring signed quotes |
| 4 | Inventory units, concierge shifts and atomic service allocations | Media upload/video cards, custom service coverage and staff UI |
| 5 | Sandbox links, signed sandbox webhook, idempotency, late-payment review and outbox | Live provider, reconciliation/refunds, notification delivery |
| 6 | Pending extensions, separate sandbox payment, promotion and rollback | Production provider/pay-later operations and owner policy |
| 7 | Initial responsive customer UI and CI workflow | MFA admin, full operations UI, mobile QA and deployment |

Local verification: 48 functional/domain/database/auth tests pass, TypeScript passes, and Vinext production build passes.

Local database tests use embedded PostgreSQL with serialized transactions. All 26 tests also passed on native PostgreSQL 17 in GitHub CI run 37898186888, including concurrent checkout/resource and webhook/expiry races. Browser/mobile runtime tests have not been completed.

Dependencies updated to Vinext 1.1, Vite 8.3.4 and patched Next/React packages. npm audit still reports 6 high and 3 moderate transitive findings in Vinext plugin/OG dependencies; resolve or assess applicability before production. No critical findings remain.

Production customer booking/payment APIs stay disabled pending live-provider integration. Production admin has its own database and Access MFA activation gate.

## Phase 2 schedule administration update

`/admin` now provides weekly hours, multiple opening windows, overnight closing, closed/special date overrides, a Bangkok day operations view and blackout creation/release. The view includes occupied setup/cleanup intervals, holds and pending extensions. Schedule saves reject stale revisions and report existing reservations requiring review without cancelling them or changing their price snapshots. Blackout release keeps the original allocation and audit history.

The UI and APIs work only in the explicitly enabled development sandbox with the configured admin token. The deployed production page displays setup requirements and cannot edit data. Production activation needs connected PostgreSQL and individual MFA-protected staff accounts; the payment gateway is still required for live customer checkout.

This completes the schedule-controls slice of Phase 2, not the full product roadmap Phase 2 admin MVP. Catalog/media editing, staff assignment screens, booking change/cancellation operations and payment reconciliation/refund panels remain to build.

## Remaining Phase 2 operations implementation

Added migration `002_admin`, first-owner provisioning, server-verified Access JWT login with individual account roles and revocation, venue/rate editing, catalog/media URL editing, inventory and concierge shifts, transactional reassignment, staff-scoped fulfillment notes, bookings, payment review queue and owner audit/team access screens. Native provider payment state cannot be edited through these screens. PostgreSQL and Access credentials/policy are still required to activate production admin; production checkout remains closed. Direct signed uploads, automatic reconciliation/refunds, notifications and full mobile runtime QA remain outstanding.

## Neon provisioning

Created a Singapore PostgreSQL 17 Neon project with production and development branches. Both contain all 16 tables, both numbered migrations and `btree_gist`. Development SQL checks verified exclusion protection for space, inventory and concierge units and rolled back their test fixtures. Production has no bookings, spaces or admin accounts. A restricted `venue_app` role has explicit runtime privileges and cannot rewrite audit history or create schemas/databases/roles.

Added an optional Neon WebSocket driver for Cloudflare interactive transactions and request-scoped pool cleanup. Native `pg` remains the default for local and CI databases. All 41 local tests, TypeScript and the Cloudflare build pass. Worker runtime secrets, confirmed owner login and Access MFA policy remain to connect; no live editing or customer checkout has been enabled. See [Neon setup](NEON_SETUP.md).

## Phase 3 quote and payment recovery slice

After explicit approval the first owner account was provisioned; Cloudflare Access identity binding and MFA configuration remain pending. Added HMAC-signed expiring quote tokens, server expiry validation, quote invalidation UI, and `/booking/{id}` payment-return status with bounded polling, existing-link recovery, exception guidance and separate pending-extension display. Redirect query parameters cannot confirm a booking. Interrupted hold retries retain their original idempotent result after quote expiry; new requests cannot use expired or altered tokens.

All 48 local tests, TypeScript and Cloudflare production build pass. `QUOTE_SIGNING_SECRET` must be installed before customer quotes can run. This completes the quote/recovery slice; a live provider, reconciliation/refunds, reminder/email delivery, signed media uploads and full mobile runtime QA remain outstanding. Production payment/admin activation gates remain enforced.

## Confirmation email and reminder slice

Added migration `003_notifications`, persistent leased delivery with Resend, immutable payment-confirmation content, schedule-specific reminders, retry/manual-review handling, Cloudflare five-minute cron and an owner/manager Emails operations view. 56 local tests pass; TypeScript passes. Migration 003 applied to development and production Neon, with restricted runtime queue privileges verified. Resend is connected but has no sending domain, so sending stays disabled pending verified sender/key and Worker runtime configuration. Live delivery/bounce handling and cross-device customer recovery remain outstanding.

The owner selected **Payso** as the live provider. See PAYSO_INTEGRATION.md for verified documentation and missing merchant callback/inquiry/expiry contracts. Payso is not connected or enabled. Cloudflare database/MFA activation and physical iPhone/Android testing remain incomplete; see LAUNCH_VALIDATION.md. Earlier sections are historical milestones, not the current launch checklist.

## Signed email delivery and suppression

Implemented Resend/Svix raw-body and timestamp verification, independent fail-closed webhook route, event deduplication/conflict detection, delivery status, early-callback reconciliation and suppression of future sends after bounce/complaint/provider suppression. Added migration 004 and minimal runtime grants to production after development migration validation. Event payloads and contact details are not logged or stored in the delivery ledger. Owner/manager Emails now shows separate delivery state. 61 local tests pass. Runtime webhook secret, sender domain, actual provider callback tests and customer cross-device recovery still require completion. Payso integration and Cloudflare admin MFA remain unchanged and closed.

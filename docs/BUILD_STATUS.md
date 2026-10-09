# Initial venue-engine build status

2026-10-09

| Phase | Delivered in this build | Still required |
| --- | --- | --- |
| 1 | Schema, buffers, exclusion constraints, transactional allocations | Provision live DB |
| 2 | Weekly/special hours, overnight handling and blackout API | Owner settings and admin schedule UI |
| 3 | 2-hour base + hourly OT, satang quotes and configuration API | Actual rates, advanced taxes/discounts and expiring signed quotes |
| 4 | Inventory units, concierge shifts and atomic service allocations | Media upload/video cards, custom service coverage and staff UI |
| 5 | Sandbox links, signed sandbox webhook, idempotency, late-payment review and outbox | Live provider, reconciliation/refunds, notification delivery |
| 6 | Pending extensions, separate sandbox payment, promotion and rollback | Production provider/pay-later operations and owner policy |
| 7 | Initial responsive customer UI and CI workflow | MFA admin, full operations UI, mobile QA and deployment |

Local verification: 26 functional/domain/database tests pass, TypeScript passes, and Vinext production build passes.

Local database tests use embedded PostgreSQL with serialized transactions. All 26 tests also passed on native PostgreSQL 17 in GitHub CI run 37898186888, including concurrent checkout/resource and webhook/expiry races. Browser/mobile runtime tests have not been completed.

Dependencies updated to Vinext 1.1, Vite 8.3.4 and patched Next/React packages. npm audit still reports 6 high and 3 moderate transitive findings in Vinext plugin/OG dependencies; resolve or assess applicability before production. No critical findings remain.

Production API is deliberately disabled pending the live-provider and staff-authentication gates.

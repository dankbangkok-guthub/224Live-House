# Initial venue-engine build status

2026-10-09

| Phase | Delivered in this build | Still required |
| --- | --- | --- |
| 1 | Schema, buffers, exclusion constraints, transactional allocations | Provision live DB; native concurrency CI gate |
| 2 | Weekly/special hours, overnight handling and blackout API | Owner settings and admin schedule UI |
| 3 | 2-hour base + hourly OT, satang quotes and configuration API | Actual rates, advanced taxes/discounts and expiring signed quotes |
| 4 | Inventory units, concierge shifts and atomic service allocations | Media upload/video cards, custom service coverage and staff UI |
| 5 | Sandbox links, signed sandbox webhook, idempotency, late-payment review and outbox | Live provider, reconciliation/refunds, notification delivery |
| 6 | Pending extensions, separate sandbox payment, promotion and rollback | Production provider/pay-later operations and owner policy |
| 7 | Initial responsive customer UI and CI workflow | MFA admin, full operations UI, mobile QA and deployment |

Local verification: 26 functional/domain/database tests pass, TypeScript passes, and Vinext production build passes.

Local database tests use embedded PostgreSQL with serialized transactions. Native PostgreSQL concurrency tests run separately in GitHub CI; do not infer their result from local tests. Browser/mobile runtime tests have not been completed.

Production API is deliberately disabled pending the live-provider and staff-authentication gates.

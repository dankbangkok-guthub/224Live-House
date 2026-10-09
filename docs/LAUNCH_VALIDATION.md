# Launch validation — 2026-10-09

| Gate | Evidence/status |
| --- | --- |
| Domain, SQL and payment sandbox | 56 local tests passed, including five persistent-queue scenarios and three email adapter/rendering tests |
| Native PostgreSQL concurrent connections | GitHub CI required for this commit; local embedded tests are not native locking evidence |
| TypeScript and Cloudflare bundle | Checked during this build; final deployment checks recorded in commit checks |
| Neon migrations | 001–003 applied to development then production; restricted runtime outbox access verified |
| Cloudflare database and admin MFA | Not activated: runtime secrets and Access policy/account integration remain pending |
| Resend live sending | No sending domains in connected account; no real messages sent; verified sender/key and delivery/bounce handling pending |
| Payso live checkout | Owner selected Payso; merchant credentials, definitive callback/inquiry/expiry contract and adapter tests pending |
| iPhone Safari and Android Chrome | No physical-device evidence available; not passed |
| Launch | Not ready; production booking/payment routes remain closed |

## Required phone walkthroughs

Use controlled approved test records, Payso test mode and authorized recipients. On each real phone verify date/time controls, two-hour minimum, +1-hour OT and end time, overnight hours/buffers, add-on quantity/capacity failures, accessible media/errors, sticky mobile total, policy acceptance and authoritative amount. Continue to hosted checkout, complete payment, close/disconnect before redirect, return and verify server-only confirmation, email and secure booking access. Repeat failure/retry and duplicate callback cases, and an extension with its separate payment link. Confirm manager calendar and concierge assignment match. Verify pending/manual-review messaging and no duplicate charge/notification.

Owner still needs to configure actual venue capacity/hours/buffers, rates, services, policies, sender/support details and live payment methods. Never enable MFA flags without the external policy or release provider-processing holds using sandbox expiry logic.

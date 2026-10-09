# Confirmation emails and event reminders

Implemented 2026-10-09. Resend is connected to this work session; its domain list is empty. This connection does not automatically install a Worker API key.

## Implemented behavior

- Payment verification writes one notification in the same transaction as booking/extension confirmation. It snapshots the paid schedule, itemized quotation, accepted rules and transaction amount.
- Five-minute Cloudflare cron enqueues reminders for confirmed events within the configurable lead window (default 24 hours, whole hours 1–168).
- PostgreSQL row locks and leases separate workers; deterministic provider keys and frozen messages protect retries. Transient failures back off; permanent failures, eight failed attempts or uncertainty older than 20 hours enter manual review before the provider's 24-hour idempotency window ends.
- Cancelled, no-longer-eligible and outdated reminders are suppressed. A changed start receives a separate schedule-specific reminder key.
- HTML escapes customer content and includes a plain-text version. Dates use Asia/Bangkok and amounts use THB.
- Owner/manager operations dashboard includes Emails with status, retry schedule, attempt count and provider reference. Staff cannot access the queue.
- `accepted` means Resend accepted the request. `delivery_status` tracks recipient-server delivery, delays, failures, bounces, complaints and suppression from verified callbacks. Neither state proves inbox placement or reading. Existing `delivered_at` remains an acceptance timestamp for compatibility; `delivery_event_at` records the provider event time.

## Activation

1. Add the venue's approved sender domain in Resend, install the provided DNS records, and verify sending. Choose the sender mailbox; no domain or mailbox is invented by this build.
2. Apply versioned migration `003_notifications` using the migration role. Applied to development first and then production Neon on 2026-10-09; runtime queue privileges were verified.
3. Install `RESEND_API_KEY` as a Cloudflare Worker runtime secret. Use a scoped sending key; never commit or place it in browser variables.
4. Set runtime `EMAIL_FROM` to the approved bare email address, `APP_ORIGIN` to the HTTPS site origin, `DATABASE_DRIVER=neon`, and the restricted `DATABASE_URL` secret.
5. Set `REMINDER_HOURS` if required. Keep `EMAIL_ENABLED=false` until controlled recipient testing is authorized and complete; then set true. CLI scripts use exported environment variables.
6. Verify cron and an authorized test booking in provider logs and the queue. Do not manually re-send a manual-review job until its provider reference/status is checked.

## Remaining before launch

Activate and test the implemented signed Resend delivery/bounce callbacks and suppression handling. Test an approved recipient with the verified sender and actual Worker cron. Customer links currently rely on the original checkout browser's HttpOnly cookie (seven-day expiry); implement verified cross-device recovery before promising emailed account access. Rate limits, privacy/retention and venue-specific support details remain to configure. Emails are booking/payment records, not official tax invoices. No real email has been sent during this build.

References: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys

## Signed delivery callbacks

Migration `004_email_delivery` adds a minimal event ledger and recipient suppression digests. Applied development first then production on 2026-10-09; production `venue_app` has SELECT/INSERT on events and SELECT/INSERT/UPDATE on suppressions. For another environment, the migration role must grant these privileges explicitly to its runtime role.

Endpoint: `POST /api/notifications/webhook/resend`. Set `RESEND_WEBHOOK_SECRET` as a Worker runtime secret and `EMAIL_WEBHOOK_ENABLED=true` after the database and webhook are configured. The endpoint has its own gate; it does not enable customer payments or admin editing. Without configuration it returns 503. Configure these events: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`. No webhook was created in the Resend account because the Worker signing secret cannot yet be installed.

Svix verifies the exact raw body, signed headers and timestamp before JSON parsing or connecting to PostgreSQL. Requests are limited to 20KB. Events deduplicate on `svix-id`; reusing an ID with a different payload returns a conflict. Unsupported signed event types are acknowledged without storing customer activity. Only message IDs linked to the venue outbox can affect its delivery state or suppress its recipient. Events arriving before the send response is persisted are retained and reconciled when that response is saved.

Delivery evidence never regresses to sent/delayed. Complaints and permanent bounce/suppression signals stay visible even if a delivered event arrives later. Future queued sends to that normalized recipient digest are skipped; no automatic unsuppression is offered. A send already in flight at the moment of a complaint cannot be recalled. The event ledger stores IDs, hashes, status and timestamps, not raw provider payloads, contact details or email bodies. Suppression status does not change a booking or payment.

61 local tests now pass. Native PostgreSQL CI remains the separate concurrency gate. Official verification reference: https://resend.com/docs/webhooks/verify-webhooks-requests

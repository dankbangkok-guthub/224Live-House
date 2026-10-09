# 224 Live House — Private Event Space Booking Implementation Plan

Document type: Product requirements and developer implementation plan  
Status: Ready for implementation planning; production launch blocked on owner configuration and provider validation  
Prepared: 2026-10-09  
Repository: https://github.com/dankbangkok-guthub/224Live-House  
Market: Thailand | Venue timezone: Asia/Bangkok | Currency: THB

## 1. Repository discovery and scope

Inspected the default branch, main, on 2026-10-09. It contains only README.md with the heading "224Live-House". There are no application files, package manifest, database migrations, authentication implementation, deployment configuration, tests, or AGENTS.md in the inspected tree.

This is a greenfield implementation plan based on the owner's supplied booking-system specification. This commit documents the plan; it does not implement or deploy an application.

Proposed reference architecture: Next.js and TypeScript, PostgreSQL, an ORM compatible with explicit SQL migrations and transactions, object storage/CDN, hosted payment checkout, and durable background jobs. Hosting, authentication provider, database vendor, email service, and payment provider remain decisions to validate before implementation. Do not assume existing accounts or credentials.

## 2. Product outcome and scope

Customers reserve a private space for at least two whole hours, add optional one-hour blocks, choose optional media-backed services, provide event details, review a server-calculated quotation, and pay through a third-party hosted checkout.

Staff must be able to maintain availability, rates, services, concierge capacity, bookings, payments, and operational exceptions before public launch.

### Required launch behavior

- One initially bookable space; all reservations and settings use space IDs to support future spaces.
- Two-hour minimum; additional duration in whole-hour increments.
- Customer chooses time and duration, never their own hourly price.
- All rates, capacity, hours, buffers, and policies are configurable; no illustrative rates in production seeds.
- Full payment is the proposed MVP mode, subject to owner confirmation.
- THB values stored and calculated as integer satang; never floating-point money.
- UTC timestamps with Asia/Bangkok retained as venue timezone and used for display/calendar boundaries.
- Optional services: concierge, decoration, AV assistance, photography/video, food/beverage, and cleaning/setup. These are catalog examples, not promises that the venue supplies them.
- Confirmation requires verified payment and a valid capacity allocation.
- Individual role-protected accounts; MFA for owner/admin.
- Email confirmations and operational alerts, with durable retries.

### Later delivery

Deposits/balances, vouchers, holiday pricing, packages, messaging channels, multiple published spaces, analytics, and self-service rescheduling can follow the operational MVP. On-site extensions are a separate milestone from extra hours selected at initial checkout.

## 3. Customer experience

| Stage | Required behavior | Failure/empty state |
| --- | --- | --- |
| Space, date, time | Show venue media, capacity, amenities, rules, rates and valid start times; hide space picker for a single space | No slots: offer another date; never expose customer data |
| Duration | Start at 2 hours; add/remove 1 hour; show local end date/time and base/OT formula | Explain closing time, buffer or booking conflict; disable invalid increments |
| Services | Responsive image/video-poster cards with name, description, unit price, availability, detail view and Add action | Missing media gets a fallback; unavailable services cannot be automatically sold |
| Event details | Name, email, phone, optional company, event type, guests, title/notes, contact preference and service fields | Field-specific validation; guests must fit capacity |
| Review | Space, schedule, guests, base rental, each extra hour, service quantities/coverage, fees/taxes/discounts if configured, due-now total and policies | Expired/changed quote requires explicit review of new price |
| Payment | Server creates/reuses a hold and hosted checkout; redirect to provider | Pending/failed/expired screens with safe retry |
| Confirmation/manage | Verified status, booking code, schedule, selected services, amount paid, rules and secure access | Pending remains pending even after a successful browser redirect |

Desktop: booking steps plus sticky summary. Mobile: single column with sticky total/next-action bar that does not obscure fields or keyboard focus. Include loading skeletons, accessible labels/errors, keyboard navigation, visible focus, screen-reader status announcements and reduced-motion support.

Do not collect identity documents or card numbers. Store acceptance timestamps and exact immutable versions of venue rules, payment terms, privacy notice and cancellation policy.

## 4. Domain boundaries and proposed code layout

Paths below are proposed, not existing repository files.

| Area | Proposed location | Responsibility |
| --- | --- | --- |
| Public booking | src/app/(public)/book/ | Six-step flow and quote review |
| Customer access | src/app/(public)/my-booking/ | Verified access, status and requests |
| Administration | src/app/(admin)/admin/ | Overview, calendar, bookings, spaces, services, staff, payments, customers/messages, settings |
| HTTP handlers | src/app/api/ | Validation, authentication and transport only |
| Booking domain | src/server/booking/ | Allocation, lifecycle, changes, extensions |
| Availability | src/server/availability/ | Hours, blackouts, buffers and shared resources |
| Pricing | src/server/pricing/ | Effective rates, line items, integer rounding and quote versions |
| Payment adapters | src/server/payments/ | Hosted checkout, verification, reconciliation and refunds |
| Access control | src/server/auth/ | Sessions, MFA, roles and customer access |
| Jobs | src/server/jobs/ | Expiry/reconciliation, outbox and reminders |
| Data | db/migrations/ | Schema, constraints and transactional allocation primitives |
| Tests | tests/unit/, tests/integration/, tests/e2e/ | Domain, real-database concurrency and browser scenarios |

Choose exact dependency versions during scaffolding after checking runtime compatibility. Preserve a lockfile. Keep business logic independent of HTTP handlers and provider SDKs.

## 5. Pricing and quotes

Required settings: minimum_hours (2 at launch), base_hourly_rate_satang, overtime_hourly_rate_satang, max_booking_hours, slot_interval_minutes, setup/cleanup buffers, opening hours, booking lead time, booking horizon and capacity. Optional settings: deposit rule, applicable tax/fee policy and special rates.

For launch:

- hoursBooked = 2 + extraHours, where extraHours is an integer >= 0.
- rentalSubtotal = 2 × baseHourlyRate + extraHours × overtimeHourlyRate.
- service subtotal derives from each item's fixed-per-booking, per-unit or per-hour pricing rule, validated quantity and eligible coverage.
- orderTotal = rentalSubtotal + serviceSubtotal + configured fees + configured taxes - valid discounts.
- amountDueNow = orderTotal in full-payment MVP.

Use explicit rounding rules for percentage taxes, fees and future deposits. Reject unsafe integers, negative totals and quantities outside configured limits.

Persist a quote ID, expiry, revision, full item breakdown, rule versions, policy versions, schedule and resource requirements. Display estimates live but only the server quote can authorize payment. Rates use effective dates; a valid quote's price-lock behavior must be explicitly configured.

Changing date, duration, services or price-sensitive guest count creates a new quote revision. Existing checkout must be cancelled or reconciled safely before a replacement becomes payable. If a provider cannot reliably invalidate checkout, serialize replacement and handle any late payment against its original immutable revision; never apply it silently to a new price.

Missing production rates or policies must disable checkout and appear in the admin launch checklist. Demo values belong only in clearly labeled development fixtures.

## 6. Availability and atomic allocation

Use half-open occupied intervals [start, end). The occupied space interval includes setup and cleanup; service intervals may differ but must include their own preparation/turnaround constraints. Define whether buffers must fit opening hours as an explicit venue rule. Represent overnight opening windows unambiguously, including next-day end dates.

A quote does not reserve capacity. An active allocation does.

### Proposed PostgreSQL strategy

1. Represent space bookings, checkout holds, manual bookings and blackout blocks in a common allocation layer.
2. Enforce non-overlap for active exclusive allocations using a database range exclusion constraint or equivalent transactional mechanism proven under concurrency.
3. Hold expiry is an explicit state transition; do not depend on wall-clock expressions inside an index predicate.
4. Reserve service inventory and eligible concierge capacity in the same transaction as the space hold.
5. For stock greater than one, lock capacity records in deterministic resource-ID order and validate concurrent occupancy across every affected interval before allocating.
6. Reserve a specific eligible staff member or capacity-backed staff allocation during checkout; do not sell "unassigned" concierge capacity without a valid resource reservation.
7. Admin edits, blackouts, manual bookings and reschedules use the same allocation service, never a bypass.
8. Provide bounded retries for serialization conflicts/deadlocks.

Admin manual blocks that conflict with existing reservations return the conflicts and require operational resolution. Reducing stock or removing staff shifts must flag impacted allocations and avoid silently invalidating paid service commitments.

Service-buffer composition must be deterministic: overlapping setup requirements may use a maximum only when they can occur together; sequential work must add time. Snapshot the resulting occupied intervals with the booking.

### Holds and payment timing

Hold duration is configurable. Keep the provider session expiry aligned with the hold when supported. Payment initiation and hold creation use idempotency keys bound to actor/session and request-body digest.

Use a short database transaction to create allocations and a pending payment attempt. Make provider calls outside long-running database locks. Persist the result or recover it through the same provider idempotency key.

Do not free capacity solely because a browser timer elapsed. Reconcile potentially processing payments before release. For unavailable provider APIs, retain or quarantine the allocation according to a bounded escalation policy and alert operations. Provider-specific processing windows are a launch decision.

Late payment after release must attempt safe allocation under the normal constraints. If unavailable, enter manual review and offer approved refund/rebooking resolution; never overbook.

## 7. Data model

| Entity | Main purpose |
| --- | --- |
| spaces, space_media | Capacity, timezone, descriptions, publishing and galleries |
| opening_hours, special_date_hours | Weekly and exceptional opening windows, including overnight rules |
| blackout_periods | Operational blocks linked to allocation records |
| rate_rules | Effective rates, duration limits, buffers and versioned configuration |
| policy_versions, policy_acceptances | Exact immutable policy text and customer acceptance evidence |
| services, service_variants, service_media | Prices, units, bounds, lead times, availability, inclusions and media |
| staff, staff_shifts, staff_skills | Eligible workers, availability and role-linked identity |
| resource_allocations | Space, stock and staffing reservations; occupied intervals and active/released state |
| customers | Necessary contact and preference data |
| quotes, quote_items | Immutable revisioned price and requirement snapshot plus expiry |
| bookings, booking_items | Booking code, event/contact snapshot, schedule, fulfillment and commercial record |
| service_reservations | Service window, quantity, allocated resource/staff and fulfillment state |
| payment_attempts, payments | Provider sessions/transactions, expected amount/currency, attempt state and idempotency |
| payment_events | Provider/account/event ID, payload digest, verification and processing outcome |
| booking_changes, extension_requests | Requested delta, approval, pending allocations and linked payment |
| refunds | Entitlement, reserved/issued amounts, provider IDs and reconciliation status |
| notification_outbox | Template/version, recipient reference, dedupe key, retry state and delivery outcome |
| audit_logs | Actor, action, target, redacted changes and timestamp |

Unique constraints: booking code; scoped idempotency keys; provider/account/event ID; provider/account/payment ID and session ID where applicable; logical notification key. Index per-space/resource time ranges, active holds, pending payment attempts, jobs due and audit targets.

Booking fulfillment and payment/refund state are separate fields. Example fulfillment: draft, holding, pending_payment, confirmed, in_progress, completed, cancelled, hold_expired, manual_review. Payment states include pending, processing, paid, failed, partially_refunded and refunded. Refund progress is not a substitute for booking fulfillment status.

## 8. Payment adapter and recovery

Adapter contract: createCheckout, retrieveCheckout/payment, expireCheckout where supported, verifyWebhook, normalizeEvent, createRefund and retrieveRefund. Record provider capabilities explicitly. Use a fake/sandbox adapter in development; production startup must reject fake-payment configuration.

Webhook processing:

1. Verify provider signature using its current official specification and raw signed payload when required.
2. Persist/dedupe the verified event durably.
3. Check account/environment, payment/session/booking linkage, currency THB and exact expected satang.
4. Apply an allowed monotonic transition under transaction/locking. A delayed failure must not downgrade a paid payment.
5. Confirm the booking only with valid capacity allocations; otherwise create a manual-review exception.
6. Atomically enqueue confirmation/receipt/operations notifications with the state change.
7. Acknowledge durably accepted events; retry internal processing safely.
8. Reconcile missing, delayed or ambiguous events using provider API reads.

Checkout retries must reuse a viable attempt; a network timeout is not proof that creation failed. Status endpoints read the server state, not redirect parameters.

Refunds: calculate entitlement against accepted policy and approved adjustments; atomically reserve refund amounts; cap new refunds at refundable entitlement minus issued/reserved refunds. Use stable idempotency keys and reconcile uncertain results before replacement. Keep immutable financial history. Receipt/payment record content must reflect actual business status; do not label it a tax invoice without configured business requirements.

Cancellation while payment is processing enters a coordinated resolution flow. Release capacity and initiate refunds only through validated state transitions; preserve evidence and notify operations on ambiguous results.

## 9. Service catalog and concierge

Cards require image/poster, title, description, pricing unit, availability and details. Details include exclusions, variations, quantity bounds, coverage, setup requirements and optional video/gallery.

Never autoplay audio. Use responsive optimized images, lazy loading, video posters, explicit play controls, alternative text and captions. Upload through authorized signed flows; validate content type, actual file content, size and ownership before publishing.

Concierge remains optional and separately charged. Supported tasks must be bounded: setup assistance, welcoming guests, approved equipment operation, vendor coordination and venue support. Nonstandard requests require approval and a new quote.

Request-quote/manual-confirmation services are not instant purchases. MVP can collect an inquiry and exclude the requested service from guaranteed checkout. If the customer requires that service for the event, block payment until approval, then re-quote/recheck all capacity. Clearly state which scope is confirmed.

## 10. Admin, security and communications

Owner: settings, rates, financial configuration, staff accounts and reports. Manager: bookings, calendar, catalog, requests and staffing. Staff/concierge: assigned events and required operational details only.

Implement server-enforced authorization on every read/write, individual accounts, MFA for owner/admin, secure revocable sessions, CSRF protection where applicable, rate limits, input schemas, HTTPS and redacted logging. Provider secrets belong in the server secret store; admin UI should show connection status rather than returning stored secrets.

Customer links: high-entropy, short-lived, revocable, stored hashed; exchange links for secure scoped sessions and remove credentials from the visible URL. Booking code alone grants no access. Avoid third-party assets/referrer leakage on token redemption pages.

Admin navigation: Overview; Booking Calendar; Bookings; Spaces & Schedule; Additional Services; Concierge & Staff; Payments; Customers & Messages; Settings.

Launch admin must support manual blocks, rate/catalog edits, booking detail/timeline, staff shifts/assignment, payment exceptions, cancellation/refund workflow and audit history. Messaging history and reporting can expand later.

Use a transactional outbox for hold/payment instructions, paid confirmations, failure/expiry guidance, updates, assignments, reminders, OT requests/approvals and refunds. Deduplicate logical messages and retry delivery separately from financial processing. Email is the MVP default; optional SMS/LINE/Telegram require configured channels. Notifications never determine payment state.

Configure data retention, redaction, backup access and deletion procedures before launch; obtain appropriate review of the actual venue policies and privacy requirements.

## 11. API plan

| Method | Endpoint | Contract |
| --- | --- | --- |
| GET | /api/spaces | Published metadata only |
| GET | /api/availability | spaceId, local date and hours; valid starts/durations with reason codes |
| GET | /api/services | Published catalog plus schedule-specific eligibility |
| POST | /api/quotes | Validated request -> quote ID/revision/expiry/items/total/policy versions |
| POST | /api/bookings/holds | Quote ID + idempotency -> atomic space/service hold |
| POST | /api/payments/checkout | Authorized hold/revision -> hosted URL and attempt ID |
| POST | /api/payments/webhook/{provider} | Provider-authenticated event ingestion |
| GET | /api/bookings/{id}/status | Verified customer/admin scope -> redacted status/summary |
| POST | /api/bookings/{id}/extensions | Proposed added hours -> availability, approval/payment workflow |
| POST | /api/bookings/{id}/change-request | Validated change/cancel/service request |
| GET/POST/PATCH | /api/admin/... | Role-scoped operational actions with audit records |

Standard domain errors: invalid_duration, closed_period, capacity_conflict, service_unavailable, quote_expired, price_changed, payment_processing, unauthorized and manual_review_required. Return safe messages, correlation IDs and retry guidance. Do not reveal another customer's booking.

## 12. Extra hours and subsequent changes

Prebooked extra hours are included in the original reservation, quote and payment. Each adds exactly one hour at the configured OT rate.

On-site/post-booking extension flow:
- Authorize request and check venue/service/staff capacity.
- Reserve the additional interval with a pending extension allocation before payment.
- Account for the old cleanup buffer moving to the new end time and expanded service coverage.
- Create a separate itemized adjustment quote and payment attempt.
- On verified payment, atomically consolidate the extension into the existing booking, update end time and allocations, and enqueue staff/customer updates.
- On expiry/failure, reconcile then release only the pending extension; retain the original booking unchanged.
- If payment is late and capacity is lost, use manual review/refund; never silently extend.
- Explicit staff-approved pay-later requires an authorized role, recorded reason and tracked receivable; never silently charge a saved card.

Rescheduling similarly reserves the proposed replacement before releasing the original. A failed modification must not erase the valid existing booking. Price increases/decreases create tracked adjustments/refunds rather than overwriting paid items.

## 13. Ordered delivery backlog

Each row should become a small implementation PR or cohesive PR series. Dependencies are release gates, not estimates.

| ID | Work package | Depends on | Completion gate |
| --- | --- | --- | --- |
| P0 | Record architecture/provider/hosting decisions and owner configuration checklist | None | Runtime, auth/MFA, database, jobs and storage choices documented; unknowns explicit |
| P1 | Scaffold app, environment validation, migrations, CI and basic design system | P0 | Repeatable local setup; lint/typecheck/build; secrets absent from client |
| P2 | Identity, roles, MFA and admin shell | P1 | Authorization matrix and session revocation tests pass |
| P3 | Spaces, hours, buffers, rates, policies and basic settings UI | P2 | Owner can configure venue without code; incomplete configuration blocks checkout |
| P4 | Pricing, quotes and allocation engine | P3 | Integer-money, boundary and real-database concurrency tests pass |
| P5 | Service catalog/media, inventory and concierge shifts/allocations | P4 | Concurrent last-unit/staff tests pass; request-only flow explicit |
| P6 | Six-step responsive customer booking UI | P4, P5 | Accessible quote review, validation and conflict recovery work |
| P7 | Holds, sandbox payment adapter, webhook ingestion and reconciliation | P4, P6 | Duplicate/out-of-order/timeout/late-payment tests pass |
| P8 | Operational calendar, booking timeline, payment exceptions and cancellation/refunds | P2, P7 | Managers can manage every launch booking state safely |
| P9 | Customer secure access, outbox/email, receipts and basic reminders | P7, P8 | Payment-confirmed messages deduped; failed notifications retry |
| P10 | Approved live provider integration and launch rehearsal | P0, P7–P9 | Provider sandbox end-to-end, recovery drill and mobile acceptance pass |
| P11 | Post-booking/on-site extensions and change approvals | P8–P10 | Pending delta reservations and payment races tested |
| P12 | Deposits, special rates, vouchers, multiple spaces and analytics | Operational MVP | Each feature gets its own pricing/capacity/payment acceptance tests |

The public MVP includes P0–P10. Do not launch customer payment before basic admin operations and reconciliation exist. P11 is independently shippable; do not advertise self-service on-site OT until delivered.

## 14. Test and release acceptance

### Unit/domain
- Minimum 2 hours; whole-hour increments; maximum and lead-time/horizon validation.
- Exact base/OT/service totals, valid quantities, rounding, overflow and no unintended fees.
- Closing boundaries, overnight opening windows, local date vs UTC, blackouts and composed buffers.
- Policy/rate changes, quote expiry and immutable accepted versions.

### Integration using the real database
- Simultaneous holds for the same occupied interval: at most one winner.
- Last service unit or concierge shift: no overselling, even across different spaces.
- Blackout/manual booking races use the same protection.
- Hold-expiry worker racing a paid webhook never frees a confirmed booking.
- Duplicate provider events, amount/currency mismatch and out-of-order events.
- Provider checkout created but local response lost; retry finds/reuses attempt.
- Payment after hold release: reacquire safely or manual review.
- Concurrent cancellation/refund/webhook, refund caps and uncertain refund reconciliation.
- Durable outbox on transaction commit, dedupe and bounded retry/dead-letter handling.

### End-to-end and operational
- iPhone Safari and Android Chrome, including hosted payment return and lost network.
- Keyboard and screen-reader completion, visible errors, mobile sticky controls.
- Missing/broken video, no services, invalid guests and sold-out alternatives.
- Admin changes rates without deployment; new quotes use the configured version.
- Staff cannot access other events or hidden financial data.
- Customer token expiry/revocation, enumeration and access-denial checks.
- Backup restore rehearsal, stuck-payment recovery and notification failure drill.
- Staff becoming unavailable triggers an operational reassignment/recovery alert.

Release evidence must list actual commands/results, provider test scenarios and devices/browsers tested. Do not claim tests passed before implementation. No application tests were run for this documentation-only plan.

## 15. Go-live inputs and checklist

| Owner decision | Required details |
| --- | --- |
| Venue | Address, spaces, capacity, opening windows, eligible event types and support contact |
| Rental | Actual base rate, first two-hour total, OT rate and maximum duration |
| Scheduling | Start increments, lead time/horizon, setup/cleanup and overnight policy |
| Services | Names, approved media, units/prices, quantities, coverage, limitations and capacity |
| Concierge | Task boundaries, rates/minimum coverage, roster, shifts and approval rules |
| Payments | Provider/account eligibility, methods, full payment or deposit, expiry/reconciliation and refunds |
| Policies | Cancellation/rescheduling, venue/noise/age rules, privacy and accepted policy text |
| Branding | Logo, palette, typography, gallery and domain |
| Operations | Authenticated sender email, staff access, notification recipients and exception owner |
| Infrastructure | Hosting, database, secret store, object storage, job runner, monitoring and backups |

- [ ] Production rates/policies approved; no demo values published.
- [ ] Payment provider capabilities and official integration requirements checked.
- [ ] Production and sandbox credentials/data isolated.
- [ ] Verified provider confirmation, reconciliation and refund flow demonstrated.
- [ ] MFA and role restrictions enabled; customer access tested.
- [ ] Concurrency gates pass; no oversold space, stock or staff.
- [ ] Alerts, retry queues, backups and operational runbooks ready.
- [ ] Owner completes a sandbox booking and staff fulfillment rehearsal.
- [ ] Production release authorized and rollback procedure documented.

## 16. Developer handoff

Start with P0 and inspect the repository again before coding because it may have changed since this plan. Implement in the ordered work packages above, adapting paths to the selected stack without weakening the domain guarantees. Keep all genuine business rates, policies and provider credentials configurable and owner-supplied. Use a development-only sandbox adapter until the live provider has been validated. Every PR must explain changed behavior, relevant test evidence and remaining launch configuration.

Definition of done: Customers can reserve available capacity for a 2+ hour event and selected services, pay the server-authoritative amount, receive verified confirmation, and staff can manage fulfillment and exceptions without double bookings, oversold staff or untracked payments.

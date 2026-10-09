# 224 Live House — Venue Engine Phased Build

Date: 2026-10-09  
Status: Implementation brief; no engine code or deployment delivered by this document  
Parent requirements: [Space Booking Implementation Plan](SPACE_BOOKING_IMPLEMENTATION_PLAN.md)

## Architecture decision

Target: Waydidi-compatible React/TypeScript UI and Vinext/Vite on Cloudflare Workers, with Drizzle using **PostgreSQL** for all 224 booking, allocation, payment and operational data. Connect Workers to managed PostgreSQL through a supported connection/pooling layer such as Hyperdrive after runtime validation.

This updates the parent plan's provisional framework choice. Reuse relevant Waydidi UI/admin patterns; adapt domain-coupled payment and authentication code rather than copying blindly. Do not copy Waydidi databases, deployment IDs, credentials, customer records, travel rates or policies.

Use a dedicated PostgreSQL database. Do not split booking consistency across D1 and PostgreSQL. Verify the chosen managed database supports required range constraints/extensions and test transaction behavior using the selected driver. Disable query caching for authoritative availability/allocation reads; cached public calendar hints never authorize checkout.

The repository currently has documentation only. Phase 1 includes application/database scaffolding. Database host, payment provider, actual rates, venue hours/capacity and brand assets remain owner inputs. Development fixtures must be explicitly labeled and cannot enable live checkout.

## Delivery sequence

| Phase | Result | Depends on | Release gate |
| --- | --- | --- | --- |
| 1 | Safe space reservation core | Runtime/database setup | Database rejects overlapping space allocations |
| 2 | Opening hours, overnight schedules and blackouts | Phase 1 | Every occupied interval fits the venue's permitted schedule |
| 3 | Two-hour minimum pricing and extra-hour quote | Phase 2 | Server-calculated quote matches immutable checkout snapshot |
| 4 | Service inventory and concierge capacity | Phases 1–3 | One transaction reserves every required resource or none |
| 5 | Hosted checkout and payment-safe holds | Phases 1–4 | Verified payment confirms exactly once; expiry/recovery safe |
| 6 | Pending extensions with separate payment links | Phase 5 | Unpaid extension cannot change the original confirmed booking |
| 7 | Admin integration and launch rehearsal | Phases 1–6 | Mobile, financial recovery and concurrent-booking gates pass |

Admin API authorization, audit logging and safe settings controls accompany each phase. Phase 7 assembles the full operational interface; it does not defer access control until the end.

## Phase 1 — Space reservation core

### Build

- Scaffold TypeScript app, server-only database layer, Drizzle migrations, environment validation and automated checks.
- Set up spaces, bookings, resource allocations, idempotency records and audit events.
- Store event timestamps as UTC timestamptz and venue timezone as Asia/Bangkok.
- Keep event and occupied intervals separate:
  - event: [event_start, event_end)
  - occupied: [event_start - setup, event_end + cleanup)
- Snapshot effective buffers on every allocation so later setting edits cannot silently change existing reservations.
- Route holds, manual reservations, confirmed bookings and operational blocks through one allocation service.
- Use PostgreSQL exclusion constraints on active exclusive resource ranges.

Illustrative database constraint design, to be adapted to real migrations:

~~~sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- resource_id identifies an exclusively allocated space, staff member
-- or individually represented equipment unit.
ALTER TABLE resource_allocations
  ADD CONSTRAINT resource_allocations_positive_interval
  CHECK (occupied_start < occupied_end);

ALTER TABLE resource_allocations
  ADD CONSTRAINT resource_allocations_no_overlap
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(occupied_start, occupied_end, '[)') WITH &&
  ) WHERE (released_at IS NULL);
~~~

Constraint scope must include every writer. Use explicit release state, not "expires_at > now()" in an index predicate. Separate service stock >1 uses Phase 4 capacity logic.

Transaction steps: validate inputs; lock resource configuration; reserve capacity; insert booking/hold snapshot; persist idempotency result; write audit/outbox entries; commit. Handle constraint/serialization conflict with a safe domain error. Never make provider HTTP calls while database locks are held.

### Proposed service contracts

- previewSpaceAvailability(input): advisory candidates/reasons
- createSpaceHold(input, idempotencyKey): authoritative allocation
- createManualReservation(input, actor): same allocation guarantees
- releaseAllocation(input): authorized, payment-aware state transition
- inspectReservation(id, actor): authorized snapshot

### Completion tests

- Two parallel requests for the same space/range: exactly one succeeds.
- Different spaces can reserve concurrently.
- Adjacent occupied half-open ranges are allowed.
- Overlap caused solely by setup or cleanup is rejected.
- Duplicate idempotency key and identical input returns the same hold; changed input is rejected.
- A failed transaction creates no partial reservation.
- Unauthorized callers cannot block, edit or release another booking.

## Phase 2 — Opening hours, blackouts and overnight bookings

### Build

- Weekly local opening windows and special-date overrides.
- Represent overnight windows explicitly with an end-day offset; never infer midnight from ambiguous start/end values.
- Define date as venue-local date; convert requested times to UTC on the server.
- Validate slot increments, minimum duration, maximum duration, lead time and booking horizon.
- Apply a documented rule for whether preparation/cleanup must fit opening hours. Require owner configuration; development fixtures use a visible test rule.
- Define special-date override precedence and behavior across midnight.
- Validate the entire occupied interval, including buffers, rather than checking only start time.
- Add blackout records that create active space allocations under Phase 1's constraint.
- Opening-hour edits flag impacted confirmed bookings; do not automatically cancel them.
- Calendar responses expose availability and reason codes, never another customer's details.

### Overnight example

A test opening window Friday 18:00 to Saturday 02:00 allows a Friday 23:00–Saturday 01:00 event only when its buffers and duration fit. A Saturday special closure must be evaluated according to the explicit override policy, not ignored because the event began Friday.

### Completion tests

- Exactly-at-closing event with required cleanup fails when cleanup must fit.
- Friday-to-Saturday booking shows the correct end date.
- Blackout spanning midnight blocks both affected dates.
- Slot that cannot support the minimum two-hour event plus buffers is hidden.
- Special-date opening override and closed-day rules are deterministic.
- A manual blackout racing checkout cannot overlap a successful hold.

## Phase 3 — Pricing and two-hour minimum

### Build

- Effective-dated base/OT rate rules editable by owner.
- Minimum duration exactly 2 whole hours at launch; integer extraHours >= 0.
- Rental = 2 × base_hourly_satang + extraHours × overtime_hourly_satang.
- Separate immutable line items for the two-hour base and each additional hour.
- Validated quantity/coverage pricing hooks for Phase 4 services.
- Integer-satang taxes/fees/discounts only where approved and configured; explicit percentage rounding rules.
- Quotes include ID, revision, expiry, THB currency, event/occupied ranges, rate/policy versions and resource requirements.
- Changing schedule/duration/items produces a new revision and invalidates the previous unpaid quote.
- Quote creation does not reserve space; createSpaceHold revalidates everything.
- Missing production rates or policy versions disable payable checkout.

### Customer behavior

Start at 2 hours. + adds exactly one hour, recalculates local end date/time and retrieves a fresh quote. - cannot go below 2. Invalid increments display a schedule/conflict reason. Responses from older requests cannot overwrite newer selections.

### Completion tests

- 1 hour, fractions, negative extraHours and over-maximum duration fail.
- Each extra hour adds exactly one configured OT increment.
- Browser-submitted prices are ignored/rejected.
- Rate changes do not mutate accepted/paying snapshots.
- Quote total, persisted item total and eventual provider amount match.
- Fast repeated +/- interactions display the latest quote only.

## Phase 4 — Services and concierge reservations

### Build

- Catalog/media metadata, fixed/per-unit/per-hour/request-quote models and variations.
- Service eligibility: space, lead time, guest count, quantities, schedule and preparation/turnaround.
- Concierge skills, shifts, coverage windows and explicit included tasks.
- Reserve an eligible staff member during checkout even if public assignment is not yet displayed.
- Specific exclusive staff/equipment uses range constraints.
- Pooled stock/staff limits use locked capacity records and time-sweep validation.

For pooled resources:
1. Lock capacity/configuration rows for all required resource IDs in deterministic order.
2. Fetch overlapping active allocations within the requested occupied interval.
3. Evaluate demand at every interval boundary; do not simply sum all overlapping quantities, since those allocations may not overlap each other.
4. Reject if concurrent demand would exceed the configured capacity at any point.
5. Insert space and service/staff allocations in the same transaction.
6. Every inventory/shift writer uses the same locking protocol.

Service buffers compose according to actual operations: parallel preparation may use max; sequential preparation sums. Snapshot the computed result.

Request-only services are not guaranteed purchases. If required by the customer, block checkout pending approval, then re-quote and reserve capacity. Optional inquiry items must clearly state they are excluded from confirmed scope.

### Completion tests

- Two customers contesting the final service unit or staff slot: no oversell.
- Concurrent reservations in different spaces still obey shared resource limits.
- Failure to reserve concierge rolls back the space and other services.
- Shift boundary, service lead time and coverage beyond event rules work.
- Inventory reduction/shift removal identifies affected commitments.
- One concierge cannot be assigned to overlapping events.
- Missing media does not break the booking form.

## Phase 5 — Hosted payment and hold lifecycle

### Build

- Development-only fake/sandbox adapter; live adapter only after provider selection.
- Payment attempts are separate from bookings and resource allocations.
- Create payment from the immutable held quote; bind provider/account/session/payment IDs, revision, expected currency and satang.
- Hosted checkout, verified webhook ingestion, event deduplication and reconciliation jobs.
- Durable transactional outbox for customer/admin confirmation.
- Provider capability matrix: expiry, cancellation, processing windows, idempotency and refunds.
- Hold expiry reconciles pending/uncertain checkout before releasing capacity.
- Payment return URLs show server state; success parameters cannot confirm.
- Safe retry recovers/reuses existing attempts; timeout is not proof of failure.
- Price-changing modifications reconcile/cancel old attempts before making replacements payable.
- Late paid checkout must reacquire resources atomically or enter manual review/refund resolution.
- Payable live checkout disabled until actual business policies and credentials exist.

### Completion tests

- Invalid signature, wrong currency/amount/account/linkage cannot confirm.
- Duplicate/out-of-order events produce one financial effect and confirmation.
- Paid event racing hold expiry never releases a confirmed allocation.
- Lost provider-create response is recovered with the same idempotency key.
- Payment received after release does not overbook.
- Network loss after payment still reaches eventual verified confirmation.
- Notification failure does not change payment truth.

## Phase 6 — Pending extensions and separate payment links

### Build

An extension is an adjustment to an existing booking, not a new full rental. Do not charge the two-hour base again.

- Accept +1 hour blocks through authorized customer/staff request.
- Lock original booking and affected resource/configuration records.
- Validate opening hours, blackouts, new cleanup end, inventory and concierge coverage.
- Calculate extension-specific OT/service deltas using versioned configured rates; display these before payment.
- Create immutable adjustment quote, pending extension record and separate checkout attempt.
- Reserve the additional capacity before issuing a payable link.
- Update the original booking schedule only after verified matching payment or explicit authorized pay-later approval.

### Avoid self-conflicts

The original cleanup buffer overlaps part of the extended event. Do not insert an overlapping full replacement allocation and disable the database constraint.

For exclusive resources, maintain the original event snapshot and temporarily expand its allocation to cover the union of original and proposed occupied intervals. Link the extra protected range to the pending extension. The confirmed end time remains unchanged. On verified payment, promote the new schedule and buffer snapshot. On safely expired/failed payment, restore the original occupied interval transactionally.

For pooled resources, reserve only the added demand after accounting for existing coverage. Service extensions may add new capacity windows rather than extending every selected service automatically.

Allow at most one unresolved extension per booking initially. Serialize original-booking edits/cancellation and extension finalization. A failed extension must not remove the valid original reservation.

### Separate payment link contents

- Original booking code and extension request ID.
- Original and proposed local end times.
- Added hours and service coverage changes.
- Itemized delta, THB amount, adjustment policy and expiry.
- Payment status independent of original paid status.

Never silently charge a stored card. Pay-later approval requires allowed role, reason, approval timestamp and tracked receivable.

### Completion tests

- Customer requests +1 hour; original confirmed end is unchanged until verified payment.
- Two extension requests cannot create two independently payable active attempts.
- Another customer cannot reserve the held extension interval.
- New end crossing closing/blackout/next booking is rejected.
- Expired extension restores original capacity without deleting original booking.
- Original cleanup moving later does not self-conflict or violate the exclusion constraint.
- Concierge/service extension failure rolls back all pending changes.
- Late extension payment after release reacquires safely or enters manual review.
- Original cancellation racing extension payment leads to one auditable resolution.
- Duplicate extension webhook changes end time exactly once.

## Phase 7 — Operations, mobile and release

### Build

- Admin day/week/month calendar with event times vs occupied buffers, blackout/hold/confirmed states and extension badges.
- Owner rate/hours/policy controls, manager blocks/bookings, concierge assigned-task view.
- Booking detail with quote/payment/change timeline.
- Inventory and shift management with impacted-booking alerts.
- Pending/late-payment and refund exception queue.
- Customer booking status, expiring scoped access and extension request screen.
- Mobile 2-hour selector, service cards and sticky summary.
- Monitoring, outbox retries, reconciliation schedules and backup/recovery runbook.

### Launch acceptance

Run real PostgreSQL tests with independent concurrent connections; mocks are insufficient for capacity guarantees. Run browser tests and a provider sandbox rehearsal including lost redirect, timeout, late webhook and refund uncertainty.

Launch only when:
- Space, services and concierge cannot be oversold.
- Server and provider amounts agree.
- Original and extension payment states remain distinct and recoverable.
- Owner/admin MFA, staff restrictions and customer access are enforced.
- Actual hours/rates/policies/media and operational contacts are configured.
- Production configuration rejects fake-payment mode.
- Backup restore and manual-review resolution are rehearsed.

## Implementation handoff

Implement one phase at a time in reviewable commits/PRs. Each phase must provide code, migrations, focused tests, commands/results and remaining configuration. Update this document's phase status only after evidence exists. Do not describe a planned feature as built.

Use the parent specification for full product requirements. This brief controls venue-engine build order and the updated target stack.

## Current delivery status

All phases: **planned, not implemented**. This file defines the requested phased build and acceptance gates.

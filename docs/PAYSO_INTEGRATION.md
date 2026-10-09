# Payso payment integration

Selected by the owner on 2026-10-09. Stripe is no longer the intended payment integration. This document records verified public requirements; no live Payso adapter or credentials are enabled yet.

## Verified provider information

- Payso offers hosted redirect checkout and payment links. Redirect fields include merchant ID, a unique numeric reference up to 12 characters, customer email, product description and total. Public documents describe currency code `00` as THB.
- Merchant ID and merchant secret are obtained in the merchant control panel under Merchant Settings / Merchant Details. Postback and return settings are under Merchant Settings / Return Parameter.
- The public developer page describes an authenticated order inquiry API. Its example requires an API key and merchant secret; credentials must stay on the server.

Official references:
- https://api-docs.payso.co/docs/api/preparation/
- https://api-docs.payso.co/docs/api/redirect/with-channel
- https://payso.co/th/developer
- Merchant sign-in: https://controls.paysolutions.asia/th/authen

## Required account contract before implementation/activation

Obtain the approved merchant's current test/live integration guide and sanitized response examples. Confirm callback authentication/signature and raw-byte rules, exact settled/failed/pending status values, inquiry response fields, merchant/currency/amount checks, checkout-link expiry/cancellation, idempotency and refund capabilities. Public documentation retrieval did not establish these complete contracts; do not guess them or reuse sandbox HMAC verification as Payso verification.

Install merchant ID, API key and merchant secret through Cloudflare runtime settings/secrets after account access is available. Never paste secret values into GitHub, customer forms or logs.

## Planned mapping to the existing reservation engine

1. Create a transactional hold with a server-signed, current satang quotation and reserve all space/service/staff resources.
2. Allocate a database-unique provider reference for each initial payment or extension invoice. Keep extension references separate from the original booking payment.
3. Create a hosted payment link for the exact server-calculated THB amount. Public unsigned browser form fields alone do not establish amount integrity.
4. Treat postback as a signal; validate the provider-documented authentication and reconcile through the authenticated inquiry API before recording settlement. Redirects never confirm bookings.
5. Match merchant, reference, provider transaction ID, currency and exact amount to the persisted payment and quote. Process verification idempotently using the existing paid-event transaction; notify only after verified settlement.
6. Reconcile uncertain payments before freeing a hold or pending extension. Link expiry must be enforceable by the provider; unknown state retains capacity or enters manual review. Late money never overbooks.
7. Implement auditable refunds/cancellation and sandbox account tests for retries, delayed/duplicate callbacks, altered amounts, bank processing across hold expiry, extension confirmation and refund races.

Production customer payment APIs remain closed. Existing checkout and webhook code is a development sandbox and cannot accept Payso money.

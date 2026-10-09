# 224 Live House — Cloudflare deployment

Target: a new Worker called `224-live-house`, separate from Waydidi and Dank Bangkok. The account chooses its workers.dev subdomain; no live URL has been assigned or verified yet.

## Prepared

- Vinext Cloudflare Vite plugin and `nodejs_compat` Worker configuration.
- `npm run build:cloudflare` builds the Worker plus frontend assets.
- `npm run deploy:cloudflare` publishes using authenticated Wrangler.
- GitHub Actions → Deploy 224 Live House to Cloudflare → Run workflow tests on native PostgreSQL before deployment.
- API stays fail-closed in production. This initial deployment is a public booking interface with a configuration-pending message, not a live payment system.

## Cloudflare access needed

Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to the repository's `cloudflare` environment secrets, or repository secrets. Use a Cloudflare token scoped to the intended account with Workers Scripts Edit and Account Settings Read for publishing to workers.dev. Do not put tokens in source files or chat.

Alternatively, sign in to Cloudflare and connect this GitHub repository to a new Worker. Build command: `npm run build:cloudflare`. Deploy command: `npx wrangler deploy --config dist/server/wrangler.json`.

## Before accepting real bookings

Provision PostgreSQL with `btree_gist`, apply `npm run db:migrate`, and configure Workers-compatible database connectivity (Hyperdrive or a supported direct PostgreSQL connection). Configure actual rates, hours, policies and media. Integrate a real hosted-payment adapter and provider verification/reconciliation, individual admin roles/MFA, and notification delivery. Complete browser testing and dependency review. Production checkout remains disabled until these gates are implemented and verified.

The demo seed is for an isolated development database only. It must not be applied to the live venue database.

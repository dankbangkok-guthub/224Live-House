# 224 Live House Neon database

Provisioned on 2026-10-09. No business rates, customer records or owner accounts have been invented.

| Resource | Value |
| --- | --- |
| Project | `224-live-house` / `twilight-scene-60127051` |
| Region | Singapore / `aws-ap-southeast-1` |
| PostgreSQL | 17 |
| Database | `venue224` |
| Production branch | `br-shiny-hall-az2q1av4` |
| Development branch | `br-hidden-truth-azjs1qk4` |
| Runtime role | `venue_app` |

Both numbered migrations were applied first to development, then to the initially empty production database. All 16 application/migration tables exist. Live development SQL checks rejected overlapping space, inventory and concierge allocations, accepted adjacent ranges, and rolled back their fixtures. Production remains empty.

The runtime role has explicit table privileges, no superuser, database creation, role creation or schema creation privileges. It can append/read audit records but cannot rewrite them. Keep the owner/migration connection separate from the application connection.

## Cloudflare runtime connection

The database is provisioned; the deployed Worker is not yet connected. Set these on **Worker runtime settings**, not Workers Builds variables:

| Setting | Required value |
| --- | --- |
| `DATABASE_URL` (secret) | Production pooled Neon URL for `venue_app`; never put it in GitHub or browser code |
| `DATABASE_DRIVER` | `neon` |
| `APP_ORIGIN` | `https://224-live-house.goodweathermedia001.workers.dev` |
| `CF_ACCESS_ISSUER` | Actual configured Access team issuer |
| `CF_ACCESS_AUD` | Actual admin Access application audience |
| `CF_ACCESS_MFA_REQUIRED` | `true` only after the external MFA policy is configured and reviewed |
| `ADMIN_ENABLED` | `true` after database, owner identity and Access activation |

The Neon WebSocket adapter supports the engine's interactive transactions. Each API request creates and closes its own pool, as required by Cloudflare Workers. Native `pg` remains the default for local PostgreSQL and migration tooling; use `DATABASE_DRIVER=pg` there. The runtime account is intentionally not a migration account.

The first owner account was provisioned after explicit user confirmation; identity binding happens only after verified Access login. Follow [admin activation](ADMIN_ACTIVATION.md) to configure Cloudflare Access and MFA before opening live editing. Customer checkout remains closed until a real hosted payment provider is integrated. Customer quotes also require the server-only `QUOTE_SIGNING_SECRET` (at least 32 random characters) and optional `QUOTE_TTL_MINUTES` (default 15, range 1–30).

Reference: [Neon connection choices](https://neon.com/docs/connect/choose-connection).

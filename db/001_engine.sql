CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS spaces (
  id text PRIMARY KEY, name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Bangkok'
    CHECK (timezone = 'Asia/Bangkok'),
  capacity integer NOT NULL CHECK (capacity > 0),
  config jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
  published boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS resource_pools (
  id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('space','inventory','concierge')),
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS resource_units (
  id text PRIMARY KEY, pool_id text NOT NULL REFERENCES resource_pools(id),
  active boolean NOT NULL DEFAULT true, shifts jsonb
);
CREATE INDEX IF NOT EXISTS resource_units_pool ON resource_units(pool_id);
CREATE TABLE IF NOT EXISTS services (
  id text PRIMARY KEY, name text NOT NULL, pool_id text REFERENCES resource_pools(id),
  config jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
  published boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY, code text UNIQUE NOT NULL, space_id text NOT NULL REFERENCES spaces(id),
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL CHECK (end_at > start_at),
  guests integer NOT NULL CHECK (guests > 0),
  status text NOT NULL CHECK (status IN ('holding','confirmed','expired','cancelled','manual_review')),
  hold_expires_at timestamptz, access_digest text NOT NULL,
  quote jsonb NOT NULL, customer jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS extensions (
  id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES bookings(id),
  original_end timestamptz NOT NULL, proposed_end timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('holding','confirmed','expired','manual_review')),
  hold_expires_at timestamptz NOT NULL, quote jsonb NOT NULL,
  original_allocations jsonb NOT NULL,
  CHECK (proposed_end > original_end)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_extension ON extensions(booking_id)
 WHERE status IN ('holding','manual_review');
CREATE TABLE IF NOT EXISTS allocations (
  id uuid PRIMARY KEY, unit_id text NOT NULL REFERENCES resource_units(id),
  booking_id uuid REFERENCES bookings(id), extension_id uuid REFERENCES extensions(id),
  service_id text REFERENCES services(id), reason text,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  released_at timestamptz, CHECK (end_at > start_at),
  EXCLUDE USING gist (
    unit_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (released_at IS NULL)
);
CREATE INDEX IF NOT EXISTS allocation_booking ON allocations(booking_id);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES bookings(id),
  extension_id uuid REFERENCES extensions(id),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0), currency text NOT NULL CHECK (currency='THB'),
  status text NOT NULL CHECK (status IN ('pending','processing','paid','failed','expired','manual_review')),
  provider text NOT NULL, session_id text UNIQUE NOT NULL, checkout_url text,
  quote_digest text NOT NULL, expires_at timestamptz NOT NULL,
  UNIQUE (extension_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_initial_payment ON payments(booking_id)
 WHERE extension_id IS NULL;
CREATE TABLE IF NOT EXISTS payment_events (
  provider text NOT NULL, event_id text NOT NULL, digest text NOT NULL,
  outcome text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,event_id)
);
CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL, key text NOT NULL, digest text NOT NULL,
  result jsonb NOT NULL, PRIMARY KEY(scope,key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY, logical_key text UNIQUE NOT NULL,
  kind text NOT NULL, booking_id uuid NOT NULL REFERENCES bookings(id),
  payload jsonb NOT NULL, delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
  target text NOT NULL, details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_accounts (
 email text PRIMARY KEY CHECK(email=lower(email)), subject text UNIQUE,
 role text NOT NULL CHECK(role IN ('owner','manager','staff')),
 unit_id text REFERENCES resource_units(id), active boolean NOT NULL DEFAULT true,
 valid_after bigint NOT NULL DEFAULT 0,
 CHECK(role!='staff' OR unit_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS fulfillment (
 allocation_id uuid PRIMARY KEY REFERENCES allocations(id),
 status text NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','started','completed','needs_help')),
 notes text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_reviews (
 payment_id uuid PRIMARY KEY REFERENCES payments(id),
 status text NOT NULL CHECK(status IN ('open','investigating','resolved')),
 notes text NOT NULL, actor text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created ON audit_logs(created_at DESC);

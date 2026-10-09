ALTER TABLE outbox ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'untracked' CHECK(delivery_status IN ('untracked','accepted','delayed','failed','delivered','suppressed','bounced','complained'));
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS delivery_event_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_provider_message ON outbox(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS email_delivery_events (
 event_id text PRIMARY KEY, digest text NOT NULL, provider_message_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('accepted','delayed','failed','delivered','suppressed','bounced','complained')),
 event_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_delivery_message ON email_delivery_events(provider_message_id);
CREATE TABLE IF NOT EXISTS email_suppressions (
 recipient_digest text PRIMARY KEY, reason text NOT NULL CHECK(reason IN ('suppressed','bounced','complained')),
 created_at timestamptz NOT NULL DEFAULT now()
);

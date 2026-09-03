-- ============================================================
-- UETA-Compliant E-Signature System
-- Migration: 20260612_signing
-- ============================================================

-- ── Signing sessions ─────────────────────────────────────────
-- One row per "send for signature" action. The document HTML is
-- frozen at send time so UETA integrity is guaranteed.
CREATE TABLE IF NOT EXISTS signing_sessions (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        UUID    REFERENCES quotes(id) ON DELETE SET NULL,
  tenant_id       UUID    NOT NULL,
  sent_by         UUID,   -- auth.users.id of the rep who clicked Send

  -- Token is the signing link secret (32 random bytes → 64 hex chars)
  token           TEXT    UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),

  -- Parties
  customer_name   TEXT    NOT NULL,
  customer_email  TEXT    NOT NULL,
  company_email   TEXT    NOT NULL DEFAULT 'RHEOhio@gmail.com',

  -- Document (frozen snapshot — never modified after creation)
  document_html   TEXT    NOT NULL,
  document_summary JSONB  DEFAULT '{}', -- {type, total, template, date, project_num}

  -- Lifecycle status
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','viewed','signed','expired','cancelled')),

  -- UETA evidence package (populated at signing time)
  signer_ip           TEXT,
  signer_user_agent   TEXT,
  signer_name_typed   TEXT,            -- typed legal name = UETA attribution
  ueta_consent_given  BOOLEAN DEFAULT FALSE,
  ueta_consent_at     TIMESTAMPTZ,
  signature_data      TEXT,            -- base64 PNG of drawn/typed signature

  -- Timestamps
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  viewed_at   TIMESTAMPTZ,
  signed_at   TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Signing events (append-only audit log) ───────────────────
CREATE TABLE IF NOT EXISTS signing_events (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID  NOT NULL REFERENCES signing_sessions(id) ON DELETE CASCADE,
  event_type  TEXT  NOT NULL,
  -- event_type values:
  --   session_created | email_sent | page_viewed | consent_given
  --   signed | completion_email_sent | expired | cancelled
  event_data  JSONB  DEFAULT '{}',
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Add signing columns to quotes ────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS signing_status     TEXT DEFAULT 'unsigned'
    CHECK (signing_status IN ('unsigned','sent','signed')),
  ADD COLUMN IF NOT EXISTS signing_session_id UUID REFERENCES signing_sessions(id),
  ADD COLUMN IF NOT EXISTS signed_at          TIMESTAMPTZ;

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_signing_sessions_token
  ON signing_sessions(token);
CREATE INDEX IF NOT EXISTS idx_signing_sessions_quote_id
  ON signing_sessions(quote_id);
CREATE INDEX IF NOT EXISTS idx_signing_sessions_tenant_id
  ON signing_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_signing_sessions_status
  ON signing_sessions(status);
CREATE INDEX IF NOT EXISTS idx_signing_events_session_id
  ON signing_events(session_id);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE signing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_events   ENABLE ROW LEVEL SECURITY;

-- Tenant members can SELECT their own sessions
DROP POLICY IF EXISTS "Tenant members view own signing sessions" ON signing_sessions;
CREATE POLICY "Tenant members view own signing sessions"
  ON signing_sessions FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Tenant members can SELECT their own events
DROP POLICY IF EXISTS "Tenant members view own signing events" ON signing_events;
CREATE POLICY "Tenant members view own signing events"
  ON signing_events FOR SELECT
  USING (
    session_id IN (
      SELECT id FROM signing_sessions
      WHERE tenant_id IN (
        SELECT tenant_id FROM users WHERE id = auth.uid()
      )
    )
  );

-- All inserts/updates go through edge functions using service role key.
-- No client-side INSERT/UPDATE policies needed.

-- ── Auto-update updated_at ────────────────────────────────────
CREATE OR REPLACE FUNCTION _update_signing_session_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signing_sessions_updated_at ON signing_sessions;
CREATE TRIGGER signing_sessions_updated_at
  BEFORE UPDATE ON signing_sessions
  FOR EACH ROW EXECUTE FUNCTION _update_signing_session_ts();

-- ── Expire stale sessions (can be called by a cron job) ──────
CREATE OR REPLACE FUNCTION expire_signing_sessions()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE signing_sessions
    SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

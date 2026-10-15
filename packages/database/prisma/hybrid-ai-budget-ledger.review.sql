-- Hybrid AI budget ledger — additive, no patient data or prompts.
-- Apply only after review and a verified production database backup.
-- PostgreSQL row locking serializes all budget decisions for a given month.
CREATE TABLE IF NOT EXISTS ai_budget_months (
  month_key TEXT PRIMARY KEY,
  openai_spent_usd NUMERIC(14,8) NOT NULL DEFAULT 0 CHECK (openai_spent_usd >= 0),
  deepseek_spent_usd NUMERIC(14,8) NOT NULL DEFAULT 0 CHECK (deepseek_spent_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_budget_month_key_format CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE TABLE IF NOT EXISTS ai_budget_reservations (
  request_id TEXT PRIMARY KEY,
  month_key TEXT NOT NULL REFERENCES ai_budget_months(month_key),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'deepseek')),
  reserved_usd NUMERIC(14,8) NOT NULL CHECK (reserved_usd > 0),
  actual_usd NUMERIC(14,8) CHECK (actual_usd >= 0),
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'SETTLED', 'CANCELLED', 'UNKNOWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_budget_reservation_actual_state CHECK (status <> 'SETTLED' OR actual_usd IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ai_budget_reservations_month_status_idx
  ON ai_budget_reservations(month_key, status);

-- Storage contract for the upcoming adapter:
-- BEGIN;
-- INSERT INTO ai_budget_months(month_key) VALUES ($month) ON CONFLICT DO NOTHING;
-- SELECT * FROM ai_budget_months WHERE month_key=$month FOR UPDATE;
-- SELECT provider, reserved_usd FROM ai_budget_reservations
--   WHERE month_key=$month AND status IN ('RESERVED','UNKNOWN');
-- Check policy against spent + all outstanding reservations; if permitted,
-- INSERT reservation using a globally unique request_id; COMMIT.
--
-- Settlement: lock month row FIRST, then reservation; record actual cost,
-- increment month provider spent, set SETTLED and commit atomically.
-- Unknown provider outcome: keep reserved funds committed, never automatically
-- cancel on timeout. Reconcile provider billing before release.
-- An exact $15 upstream provider billing guarantee is impossible when token
-- prices, billing adjustments or actual cost exceed pre-reserved estimates.

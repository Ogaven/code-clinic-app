-- Additive AI budget alert outbox; no patient or historical billing data changed.
-- One row per month and alert level ensures concurrent settlements cannot duplicate alerts.
CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  id TEXT PRIMARY KEY,
  month_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT ai_budget_alerts_month_level_key UNIQUE (month_key, level)
);
CREATE INDEX IF NOT EXISTS ai_budget_alerts_status_created_idx ON ai_budget_alerts (status, created_at);

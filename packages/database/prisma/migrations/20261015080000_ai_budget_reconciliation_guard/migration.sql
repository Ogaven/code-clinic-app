-- Fail closed: an empty ledger is not evidence of reconciled provider billing.
-- A separately audited operator process must reconcile historical charges before
-- explicitly marking a month ready. Never automatically set this flag.
ALTER TABLE ai_budget_months
  ADD COLUMN IF NOT EXISTS historically_reconciled BOOLEAN NOT NULL DEFAULT FALSE;

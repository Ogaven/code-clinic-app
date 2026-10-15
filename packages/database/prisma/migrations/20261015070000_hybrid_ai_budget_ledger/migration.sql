-- Additive hybrid AI cost ledger; no patient data or message content.
-- IMPORTANT: this migration creates empty tables only. It does not backfill
-- OpenAI usage and must not be treated as an accurate spending balance until
-- current-month provider charges have been reconciled.
CREATE TABLE "ai_budget_months" (
  "month_key" TEXT NOT NULL,
  "openai_spent_usd" DECIMAL(14,8) NOT NULL DEFAULT 0,
  "deepseek_spent_usd" DECIMAL(14,8) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_budget_months_pkey" PRIMARY KEY ("month_key"),
  CONSTRAINT "ai_budget_month_key_format" CHECK ("month_key" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "ai_budget_openai_nonnegative" CHECK ("openai_spent_usd" >= 0),
  CONSTRAINT "ai_budget_deepseek_nonnegative" CHECK ("deepseek_spent_usd" >= 0)
);

CREATE TABLE "ai_budget_reservations" (
  "request_id" TEXT NOT NULL,
  "month_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reserved_usd" DECIMAL(14,8) NOT NULL,
  "actual_usd" DECIMAL(14,8),
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_budget_reservations_pkey" PRIMARY KEY ("request_id"),
  CONSTRAINT "ai_budget_reservations_month_key_fkey" FOREIGN KEY ("month_key") REFERENCES "ai_budget_months"("month_key") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_budget_provider_valid" CHECK ("provider" IN ('openai', 'deepseek')),
  CONSTRAINT "ai_budget_reserved_positive" CHECK ("reserved_usd" > 0),
  CONSTRAINT "ai_budget_actual_nonnegative" CHECK ("actual_usd" IS NULL OR "actual_usd" >= 0),
  CONSTRAINT "ai_budget_status_valid" CHECK ("status" IN ('RESERVED', 'SETTLED', 'CANCELLED', 'UNKNOWN')),
  CONSTRAINT "ai_budget_settled_has_cost" CHECK ("status" <> 'SETTLED' OR "actual_usd" IS NOT NULL)
);

CREATE INDEX "ai_budget_reservations_month_status_idx"
  ON "ai_budget_reservations"("month_key", "status");

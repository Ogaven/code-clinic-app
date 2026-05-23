-- QuickBooks sync fields on invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "qbInvoiceId"  TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "qbCustomerId" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "qbSyncStatus" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "qbSyncedAt"   TIMESTAMP;

-- QuickBooks payment ID on payments
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "qbPaymentId" TEXT;

-- QuickBooks purchase ID on expenses
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "qbPurchaseId" TEXT;

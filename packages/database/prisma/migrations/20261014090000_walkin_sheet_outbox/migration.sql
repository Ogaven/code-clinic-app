-- Outbox records are written with the intake activity and retried separately.
-- Patient medical details are never duplicated into this table.
CREATE TABLE "walkin_sheet_outbox" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exportedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "walkin_sheet_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "walkin_sheet_outbox_activityId_key" ON "walkin_sheet_outbox"("activityId");
CREATE INDEX "walkin_sheet_outbox_status_nextAttemptAt_idx" ON "walkin_sheet_outbox"("status", "nextAttemptAt");

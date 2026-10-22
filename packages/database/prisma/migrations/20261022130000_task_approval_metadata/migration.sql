-- Optional review metadata for AI-recommended operational tasks.
-- Existing task records and statuses are preserved.
ALTER TABLE "tasks"
  ADD COLUMN "approvalStatus" TEXT,
  ADD COLUMN "proposedAction" TEXT,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNotes" TEXT;

CREATE INDEX "tasks_approvalStatus_createdAt_idx" ON "tasks"("approvalStatus", "createdAt");

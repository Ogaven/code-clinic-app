-- Add status field to leads table
ALTER TABLE "leads" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'NEW';

-- Make name nullable
ALTER TABLE "leads" ALTER COLUMN "name" DROP NOT NULL;

-- Add lastMessage field
ALTER TABLE "leads" ADD COLUMN "lastMessage" TEXT;

-- Add convertedToPatientId field
ALTER TABLE "leads" ADD COLUMN "convertedToPatientId" TEXT;

-- Remove default from source (now handled at application layer)
ALTER TABLE "leads" ALTER COLUMN "source" DROP DEFAULT;

-- Add indexes for filtering
CREATE INDEX IF NOT EXISTS "leads_source_idx" ON "leads"("source");
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads"("status");

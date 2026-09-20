-- AlterTable
-- Additive only: every new column is nullable with no default that would
-- rewrite existing rows. Existing leads simply have NULL attribution detail
-- (honestly "unattributed"), never a fabricated value.
ALTER TABLE "leads" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "campaignName" TEXT,
ADD COLUMN     "adId" TEXT,
ADD COLUMN     "adsetId" TEXT,
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "landingPageUrl" TEXT,
ADD COLUMN     "externalSubmissionId" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmTerm" TEXT;

-- CreateIndex
-- Nullable compound unique — Postgres treats each NULL as distinct, so
-- existing rows (all NULL externalSubmissionId) never conflict with each
-- other or with this constraint. Only rows that supply a real
-- externalSubmissionId for a given source are deduplicated by it, which is
-- exactly the idempotency key ingestion paths (ScoreApp, Meta Lead Ads) need.
CREATE UNIQUE INDEX "leads_source_externalSubmissionId_key" ON "leads"("source", "externalSubmissionId");

-- CreateIndex
CREATE INDEX "leads_campaignId_idx" ON "leads"("campaignId");

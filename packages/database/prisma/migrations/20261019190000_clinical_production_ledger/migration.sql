CREATE TABLE "clinical_production_entries" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "treatmentPlanId" TEXT,
  "deliveredAt" TIMESTAMP(3) NOT NULL,
  "amountUGX" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "originalEntryId" TEXT,
  "note" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinical_production_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clinical_production_kind_check" CHECK ("kind" IN ('DELIVERY', 'REVERSAL', 'ADJUSTMENT')),
  CONSTRAINT "clinical_production_amount_check" CHECK (("kind" = 'DELIVERY' AND "amountUGX" > 0 AND "originalEntryId" IS NULL) OR ("kind" IN ('REVERSAL', 'ADJUSTMENT') AND "amountUGX" <> 0 AND "originalEntryId" IS NOT NULL))
);
CREATE UNIQUE INDEX "clinical_production_entries_sourceKey_key" ON "clinical_production_entries"("sourceKey");
CREATE INDEX "clinical_production_entries_deliveredAt_idx" ON "clinical_production_entries"("deliveredAt");
CREATE INDEX "clinical_production_entries_patientId_deliveredAt_idx" ON "clinical_production_entries"("patientId", "deliveredAt");
CREATE INDEX "clinical_production_entries_appointmentId_idx" ON "clinical_production_entries"("appointmentId");
CREATE INDEX "clinical_production_entries_treatmentPlanId_idx" ON "clinical_production_entries"("treatmentPlanId");
CREATE INDEX "clinical_production_entries_originalEntryId_idx" ON "clinical_production_entries"("originalEntryId");
ALTER TABLE "clinical_production_entries" ADD CONSTRAINT "clinical_production_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_production_entries" ADD CONSTRAINT "clinical_production_entries_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_production_entries" ADD CONSTRAINT "clinical_production_entries_originalEntryId_fkey" FOREIGN KEY ("originalEntryId") REFERENCES "clinical_production_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optional source references must point to existing clinical records when supplied.
ALTER TABLE "clinical_production_entries" ADD CONSTRAINT "clinical_production_entries_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_production_entries" ADD CONSTRAINT "clinical_production_entries_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "treatment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

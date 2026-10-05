-- Add an optional explicit treatment-plan link to appointments.
-- Existing appointments remain NULL: historical relationships are not guessed.
ALTER TABLE "appointments"
  ADD COLUMN "treatmentPlanId" TEXT;

CREATE INDEX "appointments_treatmentPlanId_idx"
  ON "appointments"("treatmentPlanId");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_treatmentPlanId_fkey"
  FOREIGN KEY ("treatmentPlanId")
  REFERENCES "treatment_plans"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

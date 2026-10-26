-- Stage 1 additive coordination fields; existing treatment status and appointments untouched.
ALTER TABLE "treatment_plans"
  ADD COLUMN "patientDecision" TEXT,
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "coordinatorId" TEXT,
  ADD COLUMN "nextAction" TEXT,
  ADD COLUMN "clinicalReviewRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "treatment_plans_coordinatorId_idx" ON "treatment_plans"("coordinatorId");
CREATE INDEX "treatment_plans_patientDecision_idx" ON "treatment_plans"("patientDecision");

-- Append-only coordinator history. No automatic activation of historical plans.
CREATE TABLE "treatment_follow_up_events" (
  "id" TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "previousValues" JSONB,
  "newValues" JSONB,
  "outcome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treatment_follow_up_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treatment_follow_up_events_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "treatment_follow_up_events_plan_created_idx" ON "treatment_follow_up_events"("treatmentPlanId","createdAt");

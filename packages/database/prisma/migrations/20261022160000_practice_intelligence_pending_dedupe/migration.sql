-- Prevent concurrent submissions from creating multiple pending reviews
-- for the same verified finding. Existing lead and other tasks are unaffected.
CREATE UNIQUE INDEX "tasks_practice_intelligence_pending_evidence_unique"
ON "tasks" ("entityId")
WHERE "entityType" = 'PRACTICE_INTELLIGENCE'
  AND "approvalStatus" = 'PENDING_REVIEW';

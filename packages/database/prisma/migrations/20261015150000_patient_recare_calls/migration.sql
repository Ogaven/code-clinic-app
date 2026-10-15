-- Additive staff recare call ledger. No historical patient records are imported.
CREATE TABLE "patient_recare_calls" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "contactMethod" TEXT NOT NULL,
  "contactedAt" TIMESTAMP(3) NOT NULL,
  "reached" TEXT NOT NULL,
  "appointmentSet" BOOLEAN NOT NULL DEFAULT false,
  "appointmentDate" TIMESTAMP(3),
  "attendance" TEXT NOT NULL DEFAULT 'PENDING',
  "rescheduledDate" TIMESTAMP(3),
  "comment" TEXT,
  "recordedById" TEXT NOT NULL,
  "recordedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patient_recare_calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_recare_calls_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "patient_recare_calls_patientId_contactedAt_idx" ON "patient_recare_calls"("patientId","contactedAt");
CREATE INDEX "patient_recare_calls_contactedAt_idx" ON "patient_recare_calls"("contactedAt");

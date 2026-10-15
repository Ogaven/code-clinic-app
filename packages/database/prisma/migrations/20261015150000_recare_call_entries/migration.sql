CREATE TABLE "recare_call_entries" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "contactMethod" TEXT NOT NULL,
  "contactedAt" TIMESTAMP(3) NOT NULL,
  "calledByUserId" TEXT NOT NULL,
  "reached" TEXT NOT NULL,
  "appointmentSet" BOOLEAN NOT NULL DEFAULT false,
  "appointmentDate" TIMESTAMP(3),
  "attendanceOutcome" TEXT,
  "rescheduledDate" TIMESTAMP(3),
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recare_call_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recare_call_entries_patientId_contactedAt_idx" ON "recare_call_entries"("patientId", "contactedAt");
CREATE INDEX "recare_call_entries_contactedAt_idx" ON "recare_call_entries"("contactedAt");
CREATE INDEX "recare_call_entries_calledByUserId_idx" ON "recare_call_entries"("calledByUserId");
ALTER TABLE "recare_call_entries" ADD CONSTRAINT "recare_call_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

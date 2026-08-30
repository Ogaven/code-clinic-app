-- REVIEW ONLY. Do not apply until explicitly approved.
ALTER TABLE "treatment_plans" ADD COLUMN "doctorId" TEXT;
CREATE INDEX "treatment_plans_doctorId_idx" ON "treatment_plans"("doctorId");
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "staff_attendance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attendanceDate" DATE NOT NULL,
  "checkInAt" TIMESTAMP(3) NOT NULL,
  "checkOutAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PRESENT',
  "source" TEXT NOT NULL DEFAULT 'WEB',
  "checkInLat" DOUBLE PRECISION,
  "checkInLng" DOUBLE PRECISION,
  "checkInAccuracy" DOUBLE PRECISION,
  "checkOutLat" DOUBLE PRECISION,
  "checkOutLng" DOUBLE PRECISION,
  "checkOutAccuracy" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_attendance_userId_attendanceDate_key" ON "staff_attendance"("userId", "attendanceDate");
CREATE INDEX "staff_attendance_attendanceDate_status_idx" ON "staff_attendance"("attendanceDate", "status");
CREATE INDEX "staff_attendance_userId_checkInAt_idx" ON "staff_attendance"("userId", "checkInAt");
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

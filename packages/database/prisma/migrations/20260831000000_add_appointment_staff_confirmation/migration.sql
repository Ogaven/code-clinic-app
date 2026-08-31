-- REVIEW ONLY. Do not apply until explicitly approved.
--
-- Formalizes Appointment.staffConfirmedAt / staffConfirmedById, introduced in
-- b2738a0 as a schema.prisma change with no accompanying migration. Production
-- already has both columns and the foreign key (applied historically via the
-- since-removed automatic `db push` at API startup) — this migration exists so
-- fresh environments get the same schema, and so migration history reflects
-- what production has always actually had.
--
-- Written to be safe both on a fresh database (columns/constraint absent) and
-- on current production (columns/constraint already present, migration itself
-- unrecorded): every statement is idempotent.

ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "staffConfirmedAt" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "staffConfirmedById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_staffConfirmedById_fkey'
  ) THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_staffConfirmedById_fkey"
      FOREIGN KEY ("staffConfirmedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
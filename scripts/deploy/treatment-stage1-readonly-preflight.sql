-- Code Clinic Stage 1: read-only production migration preflight.
-- Execute with psql -X -v ON_ERROR_STOP=1 -f this-file against the EXISTING database.
-- Returns schema metadata only; does not read patient rows or modify anything.
BEGIN READ ONLY;
SELECT current_database() AS database_name, current_schema() AS schema_name, version() AS postgres_version;
SELECT to_regclass('public._prisma_migrations') AS prisma_migrations_table,
       to_regclass('public.treatment_plans') AS treatment_plans_table,
       to_regclass('public.treatment_follow_up_events') AS stage1_event_table;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='treatment_plans'
  AND column_name IN ('id','status','doctorId','followUpAt','patientDecision','decisionReason','coordinatorId','nextAction','clinicalReviewRequired')
ORDER BY column_name;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND indexname IN
('treatment_plans_coordinatorId_idx','treatment_plans_patientDecision_idx',
 'treatment_follow_up_events_plan_created_idx','treatment_follow_up_events_type_created_idx')
ORDER BY indexname;
-- Read-only migration summary; conditional SQL avoids failing on legacy databases
-- where Prisma's migration bookkeeping table was never initialized.
SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL
  THEN 'NO_PRISMA_MIGRATION_TABLE' ELSE 'PRISMA_MIGRATION_TABLE_PRESENT' END
  AS migration_tracking_status;
DO $preflight$
DECLARE failed_count bigint;
DECLARE stage1_count bigint;
DECLARE migration_record record;
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE NOTICE 'No _prisma_migrations table; migration baseline must be investigated';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL'
    INTO failed_count;
  EXECUTE 'SELECT count(*) FROM public._prisma_migrations WHERE migration_name = ''20261026102000_treatment_stage1_coordination'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL'
    INTO stage1_count;
  RAISE NOTICE 'Unresolved migration attempts: %', failed_count;
  RAISE NOTICE 'Completed Stage 1 migration records: %', stage1_count;
  -- Migration names and completion state only: no application or patient rows.
  FOR migration_record IN EXECUTE
    'SELECT migration_name, started_at, finished_at, rolled_back_at, checksum FROM public._prisma_migrations ORDER BY started_at, migration_name'
  LOOP
    RAISE NOTICE 'Migration: % | started: % | finished: % | rolled back: % | checksum: %',
      migration_record.migration_name, migration_record.started_at,
      migration_record.finished_at, migration_record.rolled_back_at,
      migration_record.checksum;
  END LOOP;
  IF failed_count > 0 THEN
    RAISE WARNING 'Unresolved Prisma migration attempts found; stop deployment and investigate';
  END IF;
END $preflight$;
COMMIT;
-- Do not share database connection strings, patient data or credentials in release logs.

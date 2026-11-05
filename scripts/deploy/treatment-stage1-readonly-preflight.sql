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
COMMIT;
-- Run this second read-only query only if _prisma_migrations exists:
-- SELECT migration_name, finished_at IS NOT NULL AS finished,
--        rolled_back_at IS NOT NULL AS rolled_back, checksum
-- FROM public._prisma_migrations ORDER BY started_at;
-- Do not share database connection strings, patient data or credentials in release logs.

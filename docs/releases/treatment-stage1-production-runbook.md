# Stage 1 Treatment Follow-up — Production Release and Recovery Runbook

**Status:** PRE-RELEASE / NOT AUTHORIZED TO DEPLOY. This document is a checklist, not evidence that any step has occurred.

## 1. Preconditions (all mandatory)

- [ ] Dr. Mugabe or authorized clinic clinical lead approves the complete workflow and the treatment-history retention policy.
- [ ] Confirm the exact production droplet, app revision, database connection target and migration status without exposing credentials in logs.
- [ ] Verify a **current** patient database backup (not just an older VM snapshot), successful backup completion, restore instructions and a non-production restore validation. Do not create paid infrastructure or enable paid backups without explicit approval.
- [ ] Review the Stage 1 migration `20261026102000_treatment_stage1_coordination` against production migration history and current schema; confirm it has not already been applied.
- [ ] Resolve the event-retention decision: `treatment_follow_up_events.treatmentPlanId` currently has `ON DELETE CASCADE`. Deleting a treatment plan therefore also deletes its event history. Choose and review a policy before changing either the SQL migration or Prisma relation.
- [ ] Confirm the production deployment operator has a documented rollback route and maintenance window.

## Deployment automation finding (verified from repository)

The production workflow `.github/workflows/deploy.yml` triggers on pushes to `main`, targets the existing production server, and **does not automatically apply Prisma migrations**. Its classification step warns when schema or migration files change and requires migrations to be applied separately first. Web/API releases use server-side locking and rollback checks, but application rollback does not undo database migrations. **Do not merge this PR expecting the new schema to be applied automatically.** Confirm the migration operator, database credentials, backup evidence and deployment sequence before approval.

## Deployment classifier and migration sequencing

The existing `scripts/deploy/classify.sh` reads `/var/www/codeclinic/.deploy-state.json` from production and fails closed if the API/web deployed SHAs cannot be resolved. It detects schema changes but **only emits a warning through the production workflow**; schema changes do not prevent the workflow from proceeding. Therefore, the release operator must explicitly ensure that the reviewed migration is already applied and compatible **before merging** this PR to `main`. The production workflow is not a database migration gate. Confirm the exact deployed SHAs and migration status as part of release evidence.

## 2. Preflight and deployment order

1. Record the currently deployed Git SHA and current API/web health checks.
2. Verify database recovery and capture the migration baseline; do not proceed if the backup or schema state is uncertain.
3. Complete the retention-policy review, including any needed migration changes, and rerun Type Check, Unit Tests and Build on the final exact commit.
4. Obtain clinical acceptance using a **non-production** environment with de-identified test records.
5. Obtain explicit production release authorization.
6. Apply the reviewed additive database migration using the existing approved deployment workflow. **Do not run `prisma migrate reset`, `db push --force-reset`, or destructive database commands in production.**
7. Deploy the approved API and web build through the existing DigitalOcean process, without changing billing or infrastructure.
8. Confirm health checks and perform limited, authorized production smoke tests without sending test patient communications.

## 3. Clinical acceptance scenarios

- Receptionist assigns an active authorized coordinator; invalid/inactive staff assignments are rejected.
- Assigned doctor can edit own treatment coordination; cross-doctor access is denied.
- Staff records Accepted, Declined or Deferred; declined/deferred plans cannot retain routine outreach schedules.
- Reception cannot clear a clinical hold; assigned doctor can clear it, with event history.
- Completed/terminal treatments cannot receive new routine follow-up schedules.
- Scheduled follow-up can be completed, dismissed or validly rescheduled with a required outcome note; unscheduled and past-date attempts are rejected.
- Concurrent staff edits return a conflict rather than silently overwriting another change.
- Every successful coordination/resolution mutation produces a corresponding treatment follow-up event.
- Existing pipeline, appointments, treatment status, notifications and patient views still work as before.

## 4. Recovery decision tree

- **Before migration:** stop, leave production untouched, investigate failed prerequisite.
- **After migration, before app deployment:** do not blindly roll back database schema. Determine whether the additive migration is compatible with the existing app; seek DBA/clinical authorization for corrective actions.
- **After app deployment, health check failure:** stop rollout, collect non-sensitive logs, restore the previous application release if schema compatibility is confirmed. Do not delete newly created patient records or restore an old snapshot over current data.
- **Suspected patient data loss or integrity issue:** halt writes/rollout as appropriate, notify clinic leadership, preserve evidence, and execute only an approved point-in-time recovery plan.

## 5. Evidence required to close the release

Record exact commit SHA, successful CI run, backup timestamp and restore validation, migration checksum/status, clinical sign-off, deployment timestamp, smoke-test results and rollback owner. Mark release complete only after all evidence is recorded.

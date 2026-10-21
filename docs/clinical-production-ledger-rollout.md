# Clinical production ledger — controlled rollout

Purpose: verified treatment delivery is separate from invoices and payments. No historical backfill.

## Before production migration
1. Identify production PostgreSQL via read-only DigitalOcean configuration inspection; never expose credentials.
2. Confirm restorable backup and authorized operator, including recovery plan.
3. Validate schema and SQL on a non-production database; verify Prisma relations and constraints.
4. Confirm the deployment workflow does not automatically apply migrations (see DEPLOYMENT.md).
5. Apply only reviewed additive SQL in an approved window, then verify constraints and health.
6. Do not run prisma db push against production. Never remove existing patient records.

## Before ledger activation
- Staff-only write API with explicit attestation and immutable audit trail.
- Verify appointment and treatment-plan patient ownership before linking.
- Idempotency, transactional correction limits, concurrent reversal protection.
- Report only approved entries using Kampala delivery dates; separate pending entries.
- Tests for permissions, replay, negative amounts, invalid links and timezone boundaries.

Current state (2026-10-21): PR #366 contains schema, recording, independent approval, pending queue, and approved-only reporting; not merged and no production migration performed. The current PR head passed GitHub CI. On the isolated PostgreSQL 18 cluster (port 55432), the populated `codeclinic_ledger_migration_test` database had 4,773 restored patients and 18 successful pre-existing Prisma migrations. The reviewed ledger SQL was executed successfully with exit status 0; the ledger table, 19 constraints, and eight indexes were inspected, including the partial reversal index excluding REJECTED entries. The ledger migration was subsequently registered as applied in the isolated database using Prisma 5.22.0 under the `postgres` OS user, with the socket on port 55432; read-only verification returned the migration with `finished_at IS NOT NULL` and zero ledger entries. Do not rerun CREATE TABLE or `migrate resolve --applied` on this copy. Six isolated rollback-only SQL scenarios passed: negative delivery rejected, invalid approval status rejected, a delivery with a different reviewer stored, duplicate sourceKey rejected, duplicate active reversal rejected, and a rejected reversal replaced. These tests establish database constraints only; they do not establish API enforcement, authenticated authorization, application audit behavior, or end-to-end acceptance. Those remain required before production release. The production checkout on `main` does not yet contain this PR's migration directory; do not modify its untracked deployment/environment files or assume `migrate deploy` can run there without staging the reviewed migration first.

## Non-production acceptance tests (required before merge)
1. Apply the migration to a disposable PostgreSQL database using `prisma migrate deploy`, then verify constraints and Prisma client generation.
2. Create a synthetic patient and two authorized test administrators in that disposable environment; never use live patient data.
3. Verify delivery submission creates PENDING, is absent from approved summary, and replaying the identical sourceKey returns the same entry without a second audit event.
4. Verify changed payload with the same sourceKey fails 409; wrong-patient appointment and treatment-plan links fail without ledger writes.
5. Verify recorder cannot approve own entry; different administrator can approve with a reason, and the summary then includes exactly that value.
6. Verify rejection leaves totals unchanged; second decision fails 409; failed audit insert rolls back the approval transaction.
7. Verify a correction cannot be recorded until the original delivery is approved; test positive and negative adjustments and a full reversal.
8. Submit two competing corrections concurrently; ensure the sum of approved corrections never exceeds the approved delivery, including reversal races. Reject a reversal and verify that a replacement reversal can be submitted; verify only one non-rejected reversal per original delivery.
9. Check Kampala midnight boundaries and corrections posted in a later month; reporting is based on effective deliveredAt and may show negative net activity.
10. Verify admin-only access to all endpoints, expired-token rejection, 31-day reporting limit, and safe error handling.
11. Confirm an independently restorable production backup and documented rollback plan before applying the additive migration. Revalidate the final exact migration SQL on a clean isolated database; do not run the edited CREATE INDEX statement over the already-migrated test copy and mistake an index-name conflict for a production problem.
12. After migration, deploy in a controlled window and verify production health without creating synthetic patient entries.

**Important:** A successful GitHub TypeScript/unit/build pipeline does not replace these database-backed acceptance tests.
## Verified release gate (2026-10-21)

GitHub Actions run 39584807067 at commit 6fe0caa passed Type Check, Unit Tests (including real authenticated HTTP requests against disposable PostgreSQL), and Build. The integration suite verifies distinct administrator approval, idempotent replay, correction limits, approved-only summaries, audit creation, and atomic rollback when an audit INSERT fails. The isolated production-backup migration rehearsal described above also passed. These results do not establish that all acceptance scenarios listed above have been covered: wrong-patient linked records, concurrent correction races, expired tokens, rejection/replacement reversal flows, and month-boundary reporting still require explicit evidence or separate coverage before the release is considered complete.

**Production deployment is blocked.** The DigitalOcean deploy workflow does not automatically apply Prisma migrations. The production database has not received the ledger table; merging the PR would deploy API code that expects it. Before merge, an authorized operator must verify a current restorable backup, stage the exact reviewed additive migration, apply and inspect it in the approved production maintenance window, and coordinate the deployment and rollback plan. Do not run `prisma db push` or create synthetic patients in production. No production migration, merge, or deployment has been performed as part of this PR.

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

Current state: PR #366 schema-only, not merged, no production migration performed.
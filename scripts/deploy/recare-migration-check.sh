#!/usr/bin/env bash
# Read-only prerequisite checks for the Code Clinic recare tracker migration.
# Run on the production host with the same DATABASE_URL used by the API.
# This script NEVER modifies the database or deploys code.
set -euo pipefail
cd /var/www/codeclinic
MIGRATION=20261015150000_patient_recare_calls
SCHEMA=packages/database/prisma/schema.prisma
PRISMA=packages/database/node_modules/.bin/prisma

test -f "$SCHEMA" || { echo "Missing Prisma schema"; exit 1; }
test -x "$PRISMA" || { echo "Prisma CLI not installed"; exit 1; }
test -f "packages/database/prisma/migrations/$MIGRATION/migration.sql" || { echo "Migration not present on host"; exit 1; }
test -n "${DATABASE_URL:-}" || { echo "DATABASE_URL is not set; load it securely using existing deployment procedures"; exit 1; }

echo "Read-only Prisma migration status:"
"$PRISMA" migrate status --schema="$SCHEMA"

echo "Before applying the migration: verify a fresh recoverable backup and confirm the API and web releases are healthy."
echo "Migration command (NOT executed): $PRISMA migrate deploy --schema=$SCHEMA"
echo "After migration: verify the table exists, then merge/deploy the API and web PR."

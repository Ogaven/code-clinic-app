#!/usr/bin/env bash
# Read-only production preflight. Run on the existing Code Clinic server.
# Never echo secrets, connection strings, patient data or access tokens.
set -euo pipefail
cd /var/www/codeclinic
node <<'NODE'
const { PrismaClient } = require('./packages/database/node_modules/@prisma/client');
const db = new PrismaClient();
(async () => {
  try {
    const names = ['20261028120000_meta_webhook_inbox', '20261028121000_meta_comment_publish_guard'];
    const migrations = await db.$queryRawUnsafe(
      'SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[])', names);
    for (const name of names) {
      const m = migrations.find(row => row.migration_name === name);
      console.log('MIGRATION_' + name + '=' + (!m ? 'MISSING' : m.rolled_back ? 'ROLLED_BACK' : m.applied ? 'APPLIED' : 'INCOMPLETE'));
    }
    for (const name of ['meta_webhook_events', 'meta_comment_publish_claims']) {
      const rows = await db.$queryRawUnsafe('SELECT to_regclass($1) IS NOT NULL AS present', 'public.' + name);
      console.log('TABLE_' + name + '=' + (rows[0].present ? 'PRESENT' : 'MISSING'));
    }
  } catch (e) {
    console.log('DATABASE_PREFLIGHT=ERROR_' + (/^P[0-9]{4}$/.test(e.code || '') ? e.code : 'UNKNOWN'));
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
})();
NODE
for name in FACEBOOK_APP_SECRET INSTAGRAM_APP_SECRET META_APP_SECRET FACEBOOK_VERIFY_TOKEN INSTAGRAM_VERIFY_TOKEN FACEBOOK_PAGE_ACCESS_TOKEN INSTAGRAM_ACCESS_TOKEN; do
  if [[ -n "${!name:-}" ]]; then echo "ENV_${name}=PRESENT"; else echo "ENV_${name}=MISSING_OR_NOT_EXPORTED"; fi
done
if command -v pg_dump >/dev/null; then echo 'PG_DUMP=AVAILABLE'; else echo 'PG_DUMP=UNAVAILABLE'; fi
echo 'PREFLIGHT_READ_ONLY=YES'

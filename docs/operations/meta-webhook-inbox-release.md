# Meta webhook durable inbox — release and reconciliation

## Release gates (production)
1. Verify the **actual** Facebook and Instagram Meta App Secret values are configured as `FACEBOOK_APP_SECRET` and `INSTAGRAM_APP_SECRET` (or `META_APP_SECRET` if both use that same app). Also verify `FACEBOOK_VERIFY_TOKEN` and `INSTAGRAM_VERIFY_TOKEN` are configured and match the Meta webhook subscriptions; the old hardcoded fallback verification tokens have been removed. Never paste or log secrets. The new POST handlers **fail closed** with HTTP 403 when verification is unavailable.
2. Confirm the API captures the exact raw request body for `X-Hub-Signature-256` verification.
3. Confirm production uses PostgreSQL and that the two migration files apply cleanly to the existing schema. Apply migrations **before** deploying API code. Back up first. **Important:** `.github/workflows/deploy.yml` explicitly does NOT run `prisma migrate deploy` or `db push` when schema files change; merging this PR without applying migrations first risks HTTP 503 webhook delivery and queue failure. The deployment workflow only warns about schema changes. Do not merge until the migration state is verified on the live server.
4. Deploy the API process and confirm the Meta subscription targets point to the expected Facebook/Instagram POST URLs.
5. Confirm incoming DMs, organic comments and ad comments arrive in the staff inbox and that job/supplier inquiries are not added as patient leads.
6. Confirm staff takeover and channel kill switches suppress automated replies.

## Read-only operations queries

```sql
SELECT "provider", "status", COUNT(*) AS events,
       MIN("createdAt") AS oldest
FROM "meta_webhook_events"
GROUP BY "provider", "status"
ORDER BY "provider", "status";

SELECT "channel", "commentId", "status", "claimedAt", "publishedAt"
FROM "meta_comment_publish_claims"
WHERE "status" = 'REVIEW_REQUIRED'
   OR ("status" = 'CLAIMED' AND "claimedAt" < NOW() - INTERVAL '5 minutes')
ORDER BY "claimedAt" ASC
LIMIT 100;
```

## Public-comment reconciliation
A claim is written **before** sending to Meta. If the network fails, or the process crashes after Meta publishes but before the local reply record is committed, the claim intentionally blocks further automatic publishing. This provides **at-most-once automatic attempts**, not guaranteed delivery.

For each `REVIEW_REQUIRED` or stale `CLAIMED` record, staff should inspect the corresponding Facebook/Instagram comment thread and the local conversation. If Meta already shows a reply, do **not** send it again. If no reply exists, staff may answer manually from the authorized Meta interface. Never delete the claim or replay automatically without a verified reconciliation procedure.

## Limits
- A successful CI run is not a live Meta delivery test.
- A missing Meta app secret means HTTP 403 and no webhook ingestion.
- No payment or paid infrastructure is required for this implementation.

# Meta webhook durable inbox — release and reconciliation

## Release gates (production)
1. Verify the **actual** Facebook and Instagram Meta App Secret values are configured as `FACEBOOK_APP_SECRET` and `INSTAGRAM_APP_SECRET` (or `META_APP_SECRET` if both use that same app). Also verify `FACEBOOK_VERIFY_TOKEN` and `INSTAGRAM_VERIFY_TOKEN` are configured and match the Meta webhook subscriptions; the old hardcoded fallback verification tokens have been removed. Never paste or log secrets. The new POST handlers **fail closed** with HTTP 403 when verification is unavailable.
2. Confirm the API captures the exact raw request body for `X-Hub-Signature-256` verification.
3. Confirm production uses PostgreSQL and that the three migration files apply cleanly to the existing schema. Apply migrations **before** deploying API code. Back up first. **Important:** `.github/workflows/deploy.yml` explicitly does NOT run `prisma migrate deploy` or `db push` when schema files change; merging this PR without applying migrations first risks HTTP 503 webhook delivery and queue failure. The deployment workflow only warns about schema changes. Do not merge until the migration state is verified on the live server.
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

## Direct-message delivery reconciliation
If a Facebook or Instagram DM send fails or times out after the outbound request starts, Meta may have accepted it even though the API received no confirmation. The inbox worker marks these events `FAILED` with `META_DM_DELIVERY_UNCERTAIN` in `lastError` instead of retrying automatically. This is a deliberate duplicate-message safeguard, not proof that the patient received a reply.

An authorized staff member must inspect the relevant Meta conversation and the local staff inbox. If the reply is visible on Meta, do not resend it. Otherwise respond manually through the authorized channel. Do not reset these failed events to PENDING without a verified delivery reconciliation. Missing access tokens and other pre-send failures may still use the normal bounded retry policy.

## Preflight execution and interpretation
The read-only helper `scripts/deploy/preflight-meta-release.sh` must be executed on the existing production server from an authorized session. It does not apply migrations, restart PM2, or print credentials. The script reports the recorded Prisma migration status and whether all expected PostgreSQL tables exist. A migration marked APPLIED with a missing table, or a present table with a missing migration record, is a **stop condition** requiring investigation, not an invitation to mark migrations as applied manually.

The PM2 process-presence check is **not** a Meta credentials or webhook-signature check. Verify secrets and webhook subscriptions through an authorized secure operational process without disclosing secret values in CI logs. Verify a recoverable database backup before changing the schema. Only after these gates pass should an authorized operator apply the exact three reviewed SQL migrations and confirm Prisma's migration history; then deploy through the existing DigitalOcean workflow. The release must not be merged just because CI passes.

**DM send crash-window mitigation:** The new `20261030190000_meta_dm_send_guard` migration adds a unique per-channel/inbound-message pre-send claim. On a retry, an existing claim suppresses automatic resending, even if the API crashed after Meta accepted the DM. Claims that remain `CLAIMED` or become `REVIEW_REQUIRED` must be manually reconciled against Meta; do not automatically clear or replay them. This is **at-most-once automatic sending**, not guaranteed delivery or exactly-once delivery. The third migration must be applied before deploying this handler.

## Direct-message send-claim reconciliation (read-only)

```sql
SELECT "channel", "messageId", "status", "claimedAt", "publishedAt"
FROM "meta_dm_send_claims"
WHERE "status" = 'REVIEW_REQUIRED'
   OR ("status" = 'CLAIMED' AND "claimedAt" < NOW() - INTERVAL '5 minutes')
ORDER BY "claimedAt" ASC
LIMIT 100;
```

Match each inbound Meta message ID against the authorized Facebook/Instagram thread and the local conversation. If an outgoing reply is already visible, do not resend. If not, staff can respond manually after confirming the recipient and message content. Never automatically delete or reset claims: they are durable safety records. A `PUBLISHED` claim with a missing local AGENT record can also indicate a crash after successful delivery; reconcile the local record without sending a second message.

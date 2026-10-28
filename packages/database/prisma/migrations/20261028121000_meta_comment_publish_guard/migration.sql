-- At-most-once automatic publish guard for Meta public comment replies.
-- A crash after Graph API accepts a reply must not result in another automatic reply.
CREATE TABLE "meta_comment_publish_claims" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CLAIMED',
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "meta_comment_publish_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meta_comment_publish_claims_status_check" CHECK ("status" IN ('CLAIMED','PUBLISHED','REVIEW_REQUIRED'))
);
CREATE UNIQUE INDEX "meta_comment_publish_claims_channel_commentId_key"
  ON "meta_comment_publish_claims" ("channel","commentId");
-- An ambiguous send is REVIEW_REQUIRED, not retried automatically. Staff should
-- reconcile Meta's actual thread before allowing any further public reply.

-- At-most-once automatic DM send claim. A claim is never automatically
-- released: a process crash may occur after Meta accepted the message.
CREATE TABLE "meta_dm_send_claims" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CLAIMED',
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "meta_dm_send_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meta_dm_send_claims_status_check" CHECK ("status" IN ('CLAIMED','PUBLISHED','REVIEW_REQUIRED'))
);
CREATE UNIQUE INDEX "meta_dm_send_claims_channel_messageId_key"
 ON "meta_dm_send_claims" ("channel","messageId");

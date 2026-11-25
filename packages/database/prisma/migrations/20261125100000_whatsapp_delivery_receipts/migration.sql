ALTER TABLE "ai_messages" ADD COLUMN "deliveryErrorCode" INTEGER;

CREATE TABLE "whatsapp_delivery_receipts" (
    "wamid" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_delivery_receipts_pkey" PRIMARY KEY ("wamid", "status")
);

-- Historical failures can be attributed only where Meta's exact message ID survived.
INSERT INTO "whatsapp_delivery_receipts" ("wamid", "status", "errorCode", "createdAt")
SELECT DISTINCT ON ("wamid") "wamid", 'failed', "code", "occurredAt"
FROM "meta_delivery_failures"
WHERE "wamid" LIKE 'wamid.%'
ORDER BY "wamid", "occurredAt" DESC, "id" DESC;

UPDATE "ai_messages" AS message
SET "status" = 'failed'
FROM "whatsapp_delivery_receipts" AS receipt, "ai_conversations" AS conversation
WHERE message."wamid" = receipt."wamid"
  AND conversation."id" = message."conversationId"
  AND conversation."channel" = 'WHATSAPP'
  AND message."role" = 'AGENT'
  AND COALESCE(lower(message."status"), '') NOT IN ('delivered', 'read', 'failed');

UPDATE "ai_messages" AS message
SET "status" = 'sent'
FROM "ai_conversations" AS conversation
WHERE conversation."id" = message."conversationId"
  AND conversation."channel" = 'WHATSAPP'
  AND message."role" = 'AGENT'
  AND message."wamid" LIKE 'wamid.%'
  AND COALESCE(lower(message."status"), '') IN ('', 'pending');

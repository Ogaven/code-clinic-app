-- CreateTable
CREATE TABLE "meta_delivery_failures" (
    "id" TEXT NOT NULL,
    "wamid" TEXT,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "recipientId" TEXT,
    "code" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "details" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_delivery_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_delivery_failures_code_occurredAt_idx" ON "meta_delivery_failures"("code", "occurredAt");

-- CreateIndex
CREATE INDEX "meta_delivery_failures_occurredAt_idx" ON "meta_delivery_failures"("occurredAt");

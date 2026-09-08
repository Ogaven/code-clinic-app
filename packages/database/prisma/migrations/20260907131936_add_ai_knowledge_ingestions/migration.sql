-- CreateTable
CREATE TABLE "ai_knowledge_ingestions" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sanitizedFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "extractedTitle" TEXT,
    "extractedText" TEXT,
    "errorMessage" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_knowledge_ingestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_knowledge_ingestions_sha256_idx" ON "ai_knowledge_ingestions"("sha256");

-- CreateIndex
CREATE INDEX "ai_knowledge_ingestions_status_createdAt_idx" ON "ai_knowledge_ingestions"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_knowledge_ingestions" ADD CONSTRAINT "ai_knowledge_ingestions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

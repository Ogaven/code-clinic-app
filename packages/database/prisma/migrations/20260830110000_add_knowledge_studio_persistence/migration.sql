-- CreateTable
CREATE TABLE "knowledge_studio_conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "createdBy" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_studio_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_studio_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_studio_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_studio_conversations_createdBy_archivedAt_updated_idx" ON "knowledge_studio_conversations"("createdBy", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "knowledge_studio_messages_conversationId_createdAt_idx" ON "knowledge_studio_messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "knowledge_studio_conversations" ADD CONSTRAINT "knowledge_studio_conversations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_studio_messages" ADD CONSTRAINT "knowledge_studio_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "knowledge_studio_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "walkin_sheet_export_lease" (
  "id" TEXT NOT NULL,
  "owner" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "walkin_sheet_export_lease_pkey" PRIMARY KEY ("id")
);
INSERT INTO "walkin_sheet_export_lease" ("id", "expiresAt", "updatedAt")
VALUES ('walkin-sheets', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

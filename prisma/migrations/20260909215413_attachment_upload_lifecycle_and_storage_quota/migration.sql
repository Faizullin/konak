-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "releaseAt" TIMESTAMP(3),
ADD COLUMN     "reservedBytes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "uploadedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "storageQuotaBytes" BIGINT NOT NULL DEFAULT 5368709120;

-- CreateIndex
CREATE INDEX "attachments_organizationId_status_idx" ON "attachments"("organizationId", "status");

-- CreateIndex
CREATE INDEX "attachments_status_releaseAt_idx" ON "attachments"("status", "releaseAt");

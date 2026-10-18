-- CreateTable
CREATE TABLE "KsEvidence" (
    "id" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KsEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KsEvidence_achievementId_idx" ON "KsEvidence"("achievementId");

-- AddForeignKey
ALTER TABLE "KsEvidence" ADD CONSTRAINT "KsEvidence_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "KsAchievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

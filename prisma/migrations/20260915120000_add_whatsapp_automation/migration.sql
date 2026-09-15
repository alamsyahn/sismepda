-- CreateEnum
CREATE TYPE "WhatsAppMessageType" AS ENUM ('ATTENDANCE_MISSING', 'ATTENDANCE_ABSENT');

-- CreateEnum
CREATE TYPE "WhatsAppSendTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "WhatsAppSendStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "WhatsAppConfiguration" (
    "type" "WhatsAppMessageType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "targetGroupJid" TEXT,
    "targetGroupName" TEXT,
    "targetResolvedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConfiguration_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "WhatsAppSendLog" (
    "id" TEXT NOT NULL,
    "type" "WhatsAppMessageType" NOT NULL,
    "trigger" "WhatsAppSendTrigger" NOT NULL,
    "status" "WhatsAppSendStatus" NOT NULL,
    "idempotencyKey" TEXT,
    "schoolDate" DATE NOT NULL,
    "scheduledSlot" TEXT,
    "targetGroupJid" TEXT,
    "targetGroupName" TEXT,
    "messageText" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "initiatedById" TEXT,

    CONSTRAINT "WhatsAppSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSendLog_idempotencyKey_key" ON "WhatsAppSendLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppSendLog_attemptedAt_idx" ON "WhatsAppSendLog"("attemptedAt");

-- CreateIndex
CREATE INDEX "WhatsAppSendLog_type_attemptedAt_idx" ON "WhatsAppSendLog"("type", "attemptedAt");

-- CreateIndex
CREATE INDEX "WhatsAppSendLog_schoolDate_idx" ON "WhatsAppSendLog"("schoolDate");

-- AddForeignKey
ALTER TABLE "WhatsAppSendLog" ADD CONSTRAINT "WhatsAppSendLog_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSendLog" ADD CONSTRAINT "WhatsAppSendLog_type_fkey" FOREIGN KEY ("type") REFERENCES "WhatsAppConfiguration"("type") ON DELETE CASCADE ON UPDATE CASCADE;


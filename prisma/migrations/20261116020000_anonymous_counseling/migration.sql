BEGIN;

ALTER TABLE "CounselingMessage"
  ADD COLUMN "readByParticipant" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "AnonymousCounselingThread" (
  "id" UUID NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  CONSTRAINT "AnonymousCounselingThread_ownerId_fkey" FOREIGN KEY ("ownerId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AnonymousCounselingThread_ownerId_key" ON "AnonymousCounselingThread"("ownerId");

CREATE TABLE "AnonymousCounselingMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "participantId" UUID NOT NULL,
  "authorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "fromSender" BOOLEAN NOT NULL,
  "readByParticipant" BOOLEAN NOT NULL DEFAULT true,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnonymousCounselingMessage_participantId_fkey" FOREIGN KEY ("participantId")
    REFERENCES "AnonymousCounselingThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AnonymousCounselingMessage_authorId_fkey" FOREIGN KEY ("authorId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AnonymousCounselingMessage_authorId_requestId_key" ON "AnonymousCounselingMessage"("authorId", "requestId");
CREATE INDEX "AnonymousCounselingMessage_participantId_createdAt_id_idx" ON "AnonymousCounselingMessage"("participantId", "createdAt", "id");

COMMIT;

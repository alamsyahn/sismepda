-- Riwayat kunjungan UKS: source of truth untuk seluruh statistik E-UKS.
CREATE TABLE "EuksVisit" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "occurredAt" DATE NOT NULL,
    "complaint" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "followUp" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EuksVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EuksVisit_occurredAt_idx" ON "EuksVisit"("occurredAt");

CREATE INDEX "EuksVisit_studentId_occurredAt_idx" ON "EuksVisit"("studentId", "occurredAt");

ALTER TABLE "EuksVisit" ADD CONSTRAINT "EuksVisit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EuksVisit" ADD CONSTRAINT "EuksVisit_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

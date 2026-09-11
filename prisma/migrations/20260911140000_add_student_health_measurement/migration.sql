-- Pengukuran tinggi & berat badan siswa sebagai data historis.
-- Aditif: hanya membuat tabel baru, tidak mengubah tabel existing.
CREATE TABLE "StudentHealthMeasurement" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "measuredAt" DATE NOT NULL,
    "heightCm" DECIMAL(5,1) NOT NULL,
    "weightKg" DECIMAL(5,1) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentHealthMeasurement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentHealthMeasurement_studentId_measuredAt_key" ON "StudentHealthMeasurement"("studentId", "measuredAt");

CREATE INDEX "StudentHealthMeasurement_studentId_measuredAt_idx" ON "StudentHealthMeasurement"("studentId", "measuredAt");

ALTER TABLE "StudentHealthMeasurement" ADD CONSTRAINT "StudentHealthMeasurement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentHealthMeasurement" ADD CONSTRAINT "StudentHealthMeasurement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

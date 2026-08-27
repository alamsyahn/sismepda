CREATE TABLE "StudentViolationPoint" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentViolationPoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentViolationPoint_studentId_occurredAt_idx"
ON "StudentViolationPoint"("studentId", "occurredAt");

ALTER TABLE "StudentViolationPoint"
ADD CONSTRAINT "StudentViolationPoint_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentViolationPoint"
ADD CONSTRAINT "StudentViolationPoint_recordedById_fkey"
FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
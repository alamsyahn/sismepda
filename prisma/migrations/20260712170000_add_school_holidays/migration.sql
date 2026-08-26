CREATE TABLE "SchoolHoliday" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolHoliday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolHoliday_date_key" ON "SchoolHoliday"("date");

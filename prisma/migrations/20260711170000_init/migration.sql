CREATE TYPE "Role" AS ENUM ('ADMIN', 'GURU');
CREATE TYPE "AttendanceStatus" AS ENUM ('HADIR', 'SAKIT', 'IZIN', 'ALFA', 'DISPENSASI');

CREATE TABLE "User" (
  "id" TEXT NOT NULL, "email" TEXT, "nip" TEXT, "passwordHash" TEXT NOT NULL,
  "name" TEXT NOT NULL, "phone" TEXT, "role" "Role" NOT NULL DEFAULT 'GURU',
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SchoolClass" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "grade" TEXT NOT NULL, "homeroomUserId" TEXT,
  CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Student" (
  "id" TEXT NOT NULL, "nisn" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "classId" TEXT NOT NULL, CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AttendanceDay" (
  "id" TEXT NOT NULL, "date" TIMESTAMP(3) NOT NULL, "classId" TEXT NOT NULL,
  "submittedById" TEXT NOT NULL, "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Attendance" (
  "id" TEXT NOT NULL, "attendanceDayId" TEXT NOT NULL, "studentId" TEXT NOT NULL,
  "status" "AttendanceStatus" NOT NULL, "note" TEXT, CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SchoolSetting" (
  "id" TEXT NOT NULL DEFAULT 'default', "schoolName" TEXT NOT NULL DEFAULT 'SMP Negeri 1 Contoh',
  "npsn" TEXT, "academicYear" TEXT NOT NULL DEFAULT '2025/2026', "semester" TEXT NOT NULL DEFAULT 'Ganjil',
  "attendanceOpenTime" TEXT NOT NULL DEFAULT '06:30', "attendanceCloseTime" TEXT NOT NULL DEFAULT '08:00',
  "autoLock" BOOLEAN NOT NULL DEFAULT true, CONSTRAINT "SchoolSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_nip_key" ON "User"("nip");
CREATE UNIQUE INDEX "SchoolClass_name_key" ON "SchoolClass"("name");
CREATE UNIQUE INDEX "SchoolClass_homeroomUserId_key" ON "SchoolClass"("homeroomUserId");
CREATE UNIQUE INDEX "Student_nisn_key" ON "Student"("nisn");
CREATE UNIQUE INDEX "AttendanceDay_classId_date_key" ON "AttendanceDay"("classId", "date");
CREATE UNIQUE INDEX "Attendance_attendanceDayId_studentId_key" ON "Attendance"("attendanceDayId", "studentId");

ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_homeroomUserId_fkey" FOREIGN KEY ("homeroomUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_attendanceDayId_fkey" FOREIGN KEY ("attendanceDayId") REFERENCES "AttendanceDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

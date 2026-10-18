-- CreateTable
CREATE TABLE "KsPeriod" (
    "id" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,

    CONSTRAINT "KsPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsActivity" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "venue" TEXT NOT NULL DEFAULT '',
    "schedule" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KsActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsCoach" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "KsCoach_pkey" PRIMARY KEY ("activityId","userId")
);

-- CreateTable
CREATE TABLE "KsMember" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joined" DATE NOT NULL,
    "left" DATE,
    "className" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KsMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsSession" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsAttendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "status" TEXT,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "KsAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsAchievement" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "activityId" TEXT,
    "title" TEXT NOT NULL,
    "organizer" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "level" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "evidence" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KsAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsParticipant" (
    "achievementId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "className" TEXT NOT NULL,

    CONSTRAINT "KsParticipant_pkey" PRIMARY KEY ("achievementId","studentId")
);

-- CreateTable
CREATE TABLE "KsReview" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "teamwork" TEXT NOT NULL,
    "independence" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KsReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsFollowup" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "due" DATE NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KsFollowup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KsHistory" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KsHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KsPeriod_year_semester_key" ON "KsPeriod"("year", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "KsActivity_periodId_name_key" ON "KsActivity"("periodId", "name");

-- CreateIndex
CREATE INDEX "KsCoach_userId_idx" ON "KsCoach"("userId");

-- CreateIndex
CREATE INDEX "KsMember_activityId_joined_left_idx" ON "KsMember"("activityId", "joined", "left");

-- CreateIndex
CREATE UNIQUE INDEX "KsMember_activityId_studentId_joined_key" ON "KsMember"("activityId", "studentId", "joined");

-- CreateIndex
CREATE INDEX "KsSession_activityId_date_idx" ON "KsSession"("activityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "KsAttendance_sessionId_memberId_key" ON "KsAttendance"("sessionId", "memberId");

-- CreateIndex
CREATE INDEX "KsAchievement_periodId_date_idx" ON "KsAchievement"("periodId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "KsReview_memberId_month_key" ON "KsReview"("memberId", "month");

-- CreateIndex
CREATE INDEX "KsHistory_entityId_createdAt_idx" ON "KsHistory"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "KsActivity" ADD CONSTRAINT "KsActivity_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "KsPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsCoach" ADD CONSTRAINT "KsCoach_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "KsActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsCoach" ADD CONSTRAINT "KsCoach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsMember" ADD CONSTRAINT "KsMember_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "KsActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsMember" ADD CONSTRAINT "KsMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsSession" ADD CONSTRAINT "KsSession_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "KsActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsAttendance" ADD CONSTRAINT "KsAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsAttendance" ADD CONSTRAINT "KsAttendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "KsMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsAchievement" ADD CONSTRAINT "KsAchievement_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "KsPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsAchievement" ADD CONSTRAINT "KsAchievement_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "KsActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsParticipant" ADD CONSTRAINT "KsParticipant_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "KsAchievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsParticipant" ADD CONSTRAINT "KsParticipant_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsReview" ADD CONSTRAINT "KsReview_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "KsMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KsFollowup" ADD CONSTRAINT "KsFollowup_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "KsActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

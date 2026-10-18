INSERT INTO "Permission" ("id", "key", "resource", "action", "scope", "label", "module", "createdAt", "updatedAt") VALUES
('perm:kesiswaan.read.all', 'kesiswaan.read.all', 'kesiswaan', 'read', 'all', 'Kesiswaan: read all', 'kesiswaan', NOW(), NOW()),
('perm:kesiswaan.read.own', 'kesiswaan.read.own', 'kesiswaan', 'read', 'own', 'Kesiswaan: read own', 'kesiswaan', NOW(), NOW()),
('perm:kesiswaan.write.all', 'kesiswaan.write.all', 'kesiswaan', 'write', 'all', 'Kesiswaan: write all', 'kesiswaan', NOW(), NOW()),
('perm:kesiswaan.write.own', 'kesiswaan.write.own', 'kesiswaan', 'write', 'own', 'Kesiswaan: write own', 'kesiswaan', NOW(), NOW()),
('perm:kesiswaan.export.all', 'kesiswaan.export.all', 'kesiswaan', 'export', 'all', 'Kesiswaan: export all', 'kesiswaan', NOW(), NOW()),
('perm:kesiswaan.export.own', 'kesiswaan.export.own', 'kesiswaan', 'export', 'own', 'Kesiswaan: export own', 'kesiswaan', NOW(), NOW()),
('perm:kesiswaan.manage', 'kesiswaan.manage', 'kesiswaan', 'manage', NULL, 'Kesiswaan: manage', 'kesiswaan', NOW(), NOW()),
('perm:kesiswaan.verify', 'kesiswaan.verify', 'kesiswaan', 'verify', NULL, 'Kesiswaan: verify', 'kesiswaan', NOW(), NOW())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "module" = EXCLUDED."module", "updatedAt" = EXCLUDED."updatedAt";

ALTER TABLE "KsPeriod" ADD CONSTRAINT "KsPeriod_dates_check" CHECK ("start" <= "end");
ALTER TABLE "KsMember" ADD CONSTRAINT "KsMember_dates_check" CHECK ("left" IS NULL OR "left" >= "joined");
ALTER TABLE "KsSession" ADD CONSTRAINT "KsSession_status_check" CHECK ("status" IN ('DRAFT','FINAL','CANCELLED'));
ALTER TABLE "KsAttendance" ADD CONSTRAINT "KsAttendance_status_check" CHECK ("status" IS NULL OR "status" IN ('H','S','I','A'));
ALTER TABLE "KsAchievement" ADD CONSTRAINT "KsAchievement_status_check" CHECK ("status" IN ('DRAFT','SUBMITTED','VERIFIED','REVISION'));
ALTER TABLE "KsAchievement" ADD CONSTRAINT "KsAchievement_level_check" CHECK ("level" IN ('Lokal','Provinsi','Nasional','Internasional'));

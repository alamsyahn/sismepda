BEGIN;

CREATE TABLE "CounselingMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestId" TEXT NOT NULL,
  "fromStudent" BOOLEAN NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "CounselingMessage_authorId_requestId_key" ON "CounselingMessage"("authorId", "requestId");
CREATE INDEX "CounselingMessage_studentId_createdAt_id_idx" ON "CounselingMessage"("studentId", "createdAt", "id");

INSERT INTO "Permission" ("id", "key", "resource", "action", "label", "module", "updatedAt")
VALUES ('perm:euks.counseling.manage', 'euks.counseling.manage', 'euks.counseling', 'manage', 'Baca dan balas pesan curhat siswa', 'euks', NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RbacRole" ("id", "key", "name", "description", "isSystem", "updatedAt")
VALUES ('role:tim_konseling', 'tim_konseling', 'Tim Konseling', 'Membaca dan membalas curhat siswa.', true, NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id FROM "RbacRole" r CROSS JOIN "Permission" p
WHERE r.id = 'role:tim_konseling' AND p.key = 'euks.counseling.manage'
ON CONFLICT DO NOTHING;

-- A fresh installation also needs the role used by student account provisioning.
INSERT INTO "RbacRole" ("id", "key", "name", "updatedAt")
VALUES ('role:siswa', 'siswa', 'Siswa', NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id FROM "RbacRole" r CROSS JOIN "Permission" p
WHERE r.id = 'role:siswa' AND p.key IN ('euks.menstruation.read.own', 'euks.menstruation.create.own', 'euks.menstruation.update.own')
ON CONFLICT DO NOTHING;

COMMIT;

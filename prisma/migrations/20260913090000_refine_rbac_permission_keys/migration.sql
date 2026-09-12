-- RBAC Phase 4: penghalusan granularitas key permission.
--
-- Aditif/rename saja. Tidak ada baris RolePermission atau UserRole yang
-- dihapus: setiap key lama DIPINDAHKAN ke key baru sehingga role yang sudah
-- terbentuk (termasuk bundle kompatibilitas Phase 3) mempertahankan grant-nya.
--
-- Key lama dipecah karena Phase 4 menuntut pemisahan operasi yang sebelumnya
-- digabung (`write` → create/update/import, `read` vs `create` pelanggaran,
-- kredensial/status dipisah dari sunting profil).
--
-- Catatan: baris permission baru hasil pemecahan (students.master.create,
-- students.master.import, students.violations.read.*, accounts.*.manage)
-- sengaja TIDAK otomatis diberikan ke role mana pun di sini. Memberikan
-- kewenangan baru secara diam-diam lewat migrasi adalah eskalasi hak.
-- Penyemaiannya dilakukan seed/administrator secara sadar.

-- 1) Rename murni: satu key lama → satu key baru.
UPDATE "Permission" SET "key" = 'reports.whatsapp.read.all', "action" = 'read', "scope" = 'all'
  WHERE "key" = 'reports.whatsapp.read';

UPDATE "Permission" SET "key" = 'students.master.update', "action" = 'update'
  WHERE "key" = 'students.master.write';

UPDATE "Permission" SET "key" = 'students.violations.create.assigned_classes', "action" = 'create'
  WHERE "key" = 'students.violations.write.assigned_classes';

UPDATE "Permission" SET "key" = 'students.violations.create.all', "action" = 'create'
  WHERE "key" = 'students.violations.write.all';

UPDATE "Permission" SET "key" = 'teachers.accounts.update', "action" = 'update'
  WHERE "key" = 'teachers.accounts.write';

UPDATE "Permission" SET "key" = 'teachers.profile.update', "action" = 'update'
  WHERE "key" = 'teachers.profile.write';

UPDATE "Permission" SET "key" = 'teachers.duties.manage', "action" = 'manage'
  WHERE "key" = 'teachers.duties.write';

UPDATE "Permission" SET "key" = 'teachers.schedule.manage', "action" = 'manage'
  WHERE "key" = 'teachers.schedule.write';

UPDATE "Permission" SET "key" = 'homerooms.assign', "action" = 'assign'
  WHERE "key" = 'homerooms.write';

UPDATE "Permission" SET "key" = 'workbook.links.update.own', "action" = 'update'
  WHERE "key" = 'workbook.links.write.own';

UPDATE "Permission" SET "key" = 'workbook.supervision.review', "action" = 'review'
  WHERE "key" = 'workbook.supervision.write';

-- 2) Role yang sebelumnya boleh MENCATAT pelanggaran harus tetap bisa MELIHAT
--    daftarnya, karena pada sistem lama keduanya satu layar yang sama. Ini
--    mempertahankan perilaku, bukan melebarkannya.
INSERT INTO "Permission" ("id", "key", "resource", "action", "scope", "label", "description", "module", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'students.violations.read.assigned_classes', 'students.violations', 'read', 'assigned_classes',
   'Lihat poin pelanggaran (kelas binaan)', NULL, 'students', NOW(), NOW()),
  (gen_random_uuid()::text, 'students.violations.read.all', 'students.violations', 'read', 'all',
   'Lihat poin pelanggaran (semua kelas)', NULL, 'students', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", target."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."key" = 'students.violations.read.assigned_classes'
WHERE source."key" = 'students.violations.create.assigned_classes'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", target."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."key" = 'students.violations.read.all'
WHERE source."key" = 'students.violations.create.all'
ON CONFLICT DO NOTHING;

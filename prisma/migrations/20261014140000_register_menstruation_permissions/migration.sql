-- Deploy runs migrations without seed: register the private health catalog only.
-- Stable IDs are used for new rows; conflicts retain existing IDs and creation times.
-- No authority assignments or role memberships are changed.
INSERT INTO "Permission" ("id", "key", "resource", "action", "scope", "label", "description", "module", "createdAt", "updatedAt") VALUES
  ('perm:euks.menstruation.read', 'euks.menstruation.read', 'euks.menstruation', 'read', NULL, 'Baca catatan menstruasi (UKS)', NULL, 'euks', NOW(), NOW()),
  ('perm:euks.menstruation.create', 'euks.menstruation.create', 'euks.menstruation', 'create', NULL, 'Catat menstruasi dan konfirmasi mingguan (UKS)', NULL, 'euks', NOW(), NOW()),
  ('perm:euks.menstruation.update', 'euks.menstruation.update', 'euks.menstruation', 'update', NULL, 'Koreksi catatan menstruasi (UKS)', NULL, 'euks', NOW(), NOW()),
  ('perm:euks.menstruation.review', 'euks.menstruation.review', 'euks.menstruation', 'review', NULL, 'Tinjau dan selesaikan konflik menstruasi', NULL, 'euks', NOW(), NOW()),
  ('perm:euks.menstruation.read.own', 'euks.menstruation.read.own', 'euks.menstruation', 'read', 'own', 'Baca kartu menstruasi sendiri', NULL, 'euks', NOW(), NOW()),
  ('perm:euks.menstruation.create.own', 'euks.menstruation.create.own', 'euks.menstruation', 'create', 'own', 'Tambah catatan menstruasi sendiri', NULL, 'euks', NOW(), NOW()),
  ('perm:euks.menstruation.update.own', 'euks.menstruation.update.own', 'euks.menstruation', 'update', 'own', 'Koreksi catatan menstruasi sendiri', NULL, 'euks', NOW(), NOW()),
  ('perm:students.accounts.manage', 'students.accounts.manage', 'students.accounts', 'manage', NULL, 'Buat akun pribadi siswa', NULL, 'students', NOW(), NOW())
ON CONFLICT ("key") DO UPDATE SET
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "scope" = EXCLUDED."scope",
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "module" = EXCLUDED."module",
  "updatedAt" = EXCLUDED."updatedAt";

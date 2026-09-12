-- RBAC Phase 5: permission domain per operasi.
-- Tidak menghapus UserRole atau RolePermission. Key satu-ke-satu di-rename;
-- key satu-ke-banyak dibuat lalu seluruh grant lama disalin untuk parity.

-- Rename satu-ke-satu.
UPDATE "Permission" SET "key"='bos.budget.update', "action"='update' WHERE "key"='bos.budget.write';
UPDATE "Permission" SET "key"='bos.categories.update', "action"='update' WHERE "key"='bos.categories.manage';
UPDATE "Permission" SET "key"='school.settings.update', "action"='update' WHERE "key"='school.settings.write';
UPDATE "Permission" SET "key"='school.class_access.manage', "action"='manage' WHERE "key"='school.class_access.write';
UPDATE "Permission" SET "key"='school.branding.update', "action"='update' WHERE "key"='school.branding.write';
UPDATE "Permission" SET "key"='euks.complaint_options.update', "action"='update' WHERE "key"='euks.complaint_options.manage';
UPDATE "Permission" SET "key"='euks.profile.update', "action"='update' WHERE "key"='euks.profile.manage';
UPDATE "Permission" SET "key"='euks.officers.update', "action"='update' WHERE "key"='euks.officers.manage';
UPDATE "Permission" SET "key"='euks.facilities.update', "action"='update' WHERE "key"='euks.facilities.manage';
UPDATE "Permission" SET "key"='euks.hero_images.update', "action"='update' WHERE "key"='euks.hero_images.manage';
UPDATE "Permission" SET "key"='euks.hero_logos.update', "action"='update' WHERE "key"='euks.hero_logos.manage';

-- Seluruh permission target baru. Seed berikutnya menyegarkan metadata.
INSERT INTO "Permission" ("id","key","resource","action","scope","label","description","module","createdAt","updatedAt") VALUES
(gen_random_uuid()::text,'bos.categories.create','bos.categories','create',NULL,'Tambah kategori BOS',NULL,'bos',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.history.read','sarpras.history','read',NULL,'Lihat riwayat Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.photos.read','sarpras.photos','read',NULL,'Lihat foto Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.locations.create','sarpras.locations','create',NULL,'Tambah lokasi Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.locations.update','sarpras.locations','update',NULL,'Ubah lokasi Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.locations.delete','sarpras.locations','delete',NULL,'Hapus lokasi Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.item_types.create','sarpras.item_types','create',NULL,'Tambah jenis barang Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.item_types.update','sarpras.item_types','update',NULL,'Ubah jenis barang Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.item_types.delete','sarpras.item_types','delete',NULL,'Hapus jenis barang Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.items.create','sarpras.items','create',NULL,'Tambah barang Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.items.update','sarpras.items','update',NULL,'Ubah barang Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.items.delete','sarpras.items','delete',NULL,'Hapus barang Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.photos.create','sarpras.photos','create',NULL,'Unggah foto Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'sarpras.photos.delete','sarpras.photos','delete',NULL,'Hapus foto Sarpras',NULL,'sarpras',NOW(),NOW()),
(gen_random_uuid()::text,'euks.content.read','euks.content','read',NULL,'Lihat konten profil E-UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.visits.create','euks.visits','create',NULL,'Catat kunjungan UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.visits.update','euks.visits','update',NULL,'Ubah kunjungan UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.visits.delete','euks.visits','delete',NULL,'Hapus kunjungan UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.measurements.read','euks.measurements','read',NULL,'Lihat pengukuran kesehatan',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.measurements.create','euks.measurements','create',NULL,'Catat pengukuran kesehatan',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.measurements.delete','euks.measurements','delete',NULL,'Hapus pengukuran kesehatan',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.sick_absences.read','euks.sick_absences','read',NULL,'Lihat absensi sakit',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.sick_absences.update','euks.sick_absences','update',NULL,'Ubah tindak lanjut absensi sakit',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.complaint_options.create','euks.complaint_options','create',NULL,'Tambah pilihan keluhan',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.officers.create','euks.officers','create',NULL,'Tambah pengurus UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.officers.delete','euks.officers','delete',NULL,'Hapus pengurus UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.facilities.create','euks.facilities','create',NULL,'Tambah fasilitas UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.facilities.delete','euks.facilities','delete',NULL,'Hapus fasilitas UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.hero_images.create','euks.hero_images','create',NULL,'Tambah gambar hero UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.hero_images.delete','euks.hero_images','delete',NULL,'Hapus gambar hero UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.hero_logos.create','euks.hero_logos','create',NULL,'Tambah logo hero UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'euks.hero_logos.delete','euks.hero_logos','delete',NULL,'Hapus logo hero UKS',NULL,'euks',NOW(),NOW()),
(gen_random_uuid()::text,'school.holidays.create','school.holidays','create',NULL,'Tambah kalender libur',NULL,'school',NOW(),NOW()),
(gen_random_uuid()::text,'school.holidays.update','school.holidays','update',NULL,'Ubah kalender libur',NULL,'school',NOW(),NOW()),
(gen_random_uuid()::text,'school.holidays.delete','school.holidays','delete',NULL,'Hapus kalender libur',NULL,'school',NOW(),NOW())
ON CONFLICT ("key") DO NOTHING;

-- Bundle BOS tetap dikelola sistem, tetapi bukan role privileged. Keamanan
-- delegasinya berasal dari allowlist + pemeriksaan isi persis pada setiap write.
UPDATE "RbacRole" SET "isSystem"=true
WHERE "key" IN ('legacy_bos_view','legacy_bos_create','legacy_bos_edit','legacy_bos_categories','legacy_bos_access');

-- Salin helper: sumber key lama -> setiap operasi yang dulu dibukanya.
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp
JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('bos.categories.create')
WHERE source."key"='bos.entries.create' ON CONFLICT DO NOTHING;

-- euks.overview.read sebelumnya membuka konten landing sekaligus statistik.
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp
JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key"='euks.content.read'
WHERE source."key"='euks.overview.read' ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('sarpras.history.read','sarpras.photos.read')
WHERE source."key"='sarpras.read' ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('sarpras.locations.create','sarpras.locations.update','sarpras.locations.delete')
WHERE source."key"='sarpras.locations.write' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('sarpras.item_types.create','sarpras.item_types.update','sarpras.item_types.delete')
WHERE source."key"='sarpras.item_types.write' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('sarpras.items.create','sarpras.items.update','sarpras.items.delete')
WHERE source."key"='sarpras.items.write' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('sarpras.photos.read','sarpras.photos.create','sarpras.photos.delete')
WHERE source."key"='sarpras.photos.write' ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.content.read','euks.visits.create','euks.visits.update','euks.visits.delete')
WHERE source."key"='euks.visits.write' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.measurements.read','euks.measurements.create','euks.measurements.delete')
WHERE source."key"='euks.measurements.write' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.sick_absences.read','euks.sick_absences.update')
WHERE source."key"='euks.sick_absences.write' ON CONFLICT DO NOTHING;

-- Copy create/delete dari config update yang sebelumnya membuka seluruh CRUD.
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.complaint_options.create') WHERE source."key"='euks.complaint_options.update' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.officers.create','euks.officers.delete') WHERE source."key"='euks.officers.update' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.facilities.create','euks.facilities.delete') WHERE source."key"='euks.facilities.update' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.hero_images.create','euks.hero_images.delete') WHERE source."key"='euks.hero_images.update' ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('euks.hero_logos.create','euks.hero_logos.delete') WHERE source."key"='euks.hero_logos.update' ON CONFLICT DO NOTHING;

-- Holiday write dulu membuka semua mutasi.
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT rp."roleId", target."id" FROM "RolePermission" rp JOIN "Permission" source ON source."id"=rp."permissionId"
JOIN "Permission" target ON target."key" IN ('school.holidays.create','school.holidays.update','school.holidays.delete')
WHERE source."key"='school.holidays.write' ON CONFLICT DO NOTHING;

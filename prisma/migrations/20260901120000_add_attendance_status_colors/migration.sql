-- Warna status absensi disimpan global sebagai JSON agar seluruh pengguna
-- melihat kombinasi yang sama. NULL berarti memakai warna default aplikasi.
ALTER TABLE "SchoolSetting"
ADD COLUMN "attendanceStatusColors" TEXT;

-- Melonggarkan check constraint media agar keadaan "hanya berkas" sah.
--
-- MASALAH YANG DIPERBAIKI
--
-- `User_photo_consistency_check` dan `SchoolSetting_favicon_complete` dibuat
-- ketika satu-satunya tempat penyimpanan media adalah kolom bytea. Keduanya
-- mensyaratkan: bila `*MimeType` dan `*UpdatedAt` terisi, maka `*Data` juga
-- WAJIB terisi.
--
-- Setelah media pindah ke penyimpanan berkas, unggahan baru menulis kunci +
-- mime + updatedAt dan sengaja TIDAK menulis bytea. Kombinasi itu melanggar
-- constraint lama, sehingga setiap unggahan foto profil dan favicon yang baru
-- gagal dengan error 500. Migrasi byte lama tidak terpengaruh karena ia
-- mempertahankan bytea, jadi kegagalan ini hanya muncul pada unggahan baru.
--
-- YANG DILAKUKAN
--
-- Constraint diganti dengan versi yang lebih longgar: media dianggap konsisten
-- bila byte-nya berada di SALAH SATU tempat — kolom bytea (legacy) atau kunci
-- penyimpanan (baru). Keadaan "tidak ada gambar sama sekali" tetap sah.
--
-- Ini MELONGGARKAN, bukan menghapus: setiap baris yang sah di bawah constraint
-- lama tetap sah di bawah constraint baru. Tidak ada kolom yang dihapus, tidak
-- ada data yang disentuh, dan tidak ada byte legacy yang dibuang.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_photo_consistency_check";

ALTER TABLE "User"
ADD CONSTRAINT "User_photo_consistency_check" CHECK (
  -- Tidak ada foto.
  ("photoData" IS NULL AND "photoKey" IS NULL AND "photoMimeType" IS NULL AND "photoUpdatedAt" IS NULL)
  OR
  -- Ada foto: byte berada di bytea legacy, di penyimpanan berkas, atau keduanya
  -- (keadaan setelah migrasi). Metadata wajib lengkap dalam kasus mana pun.
  (
    ("photoData" IS NOT NULL OR "photoKey" IS NOT NULL)
    AND "photoMimeType" IS NOT NULL
    AND "photoUpdatedAt" IS NOT NULL
  )
);

ALTER TABLE "SchoolSetting" DROP CONSTRAINT IF EXISTS "SchoolSetting_favicon_complete";

ALTER TABLE "SchoolSetting"
ADD CONSTRAINT "SchoolSetting_favicon_complete" CHECK (
  ("faviconData" IS NULL AND "faviconKey" IS NULL AND "faviconMimeType" IS NULL AND "faviconUpdatedAt" IS NULL)
  OR
  (
    ("faviconData" IS NOT NULL OR "faviconKey" IS NOT NULL)
    AND "faviconMimeType" IS NOT NULL
    AND "faviconUpdatedAt" IS NOT NULL
  )
);

-- Constraint ukuran dan tipe TIDAK diubah: keduanya sudah berbentuk
-- "IS NULL OR ..." sehingga tetap benar ketika bytea kosong. Batas ukuran
-- unggahan baru ditegakkan Upload Slot Registry sebelum byte ditulis.

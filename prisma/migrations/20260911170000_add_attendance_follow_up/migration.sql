-- Kolom tindak lanjut sekolah untuk ketidakhadiran.
--
-- Aditif dan non-destruktif: hanya menambah satu kolom nullable pada tabel
-- yang sudah ada. Tidak ada baris Attendance yang diubah, dan nilai lama
-- tetap NULL sampai diisi dari halaman Pantauan Kesehatan E-UKS.

ALTER TABLE "Attendance" ADD COLUMN "followUp" TEXT;

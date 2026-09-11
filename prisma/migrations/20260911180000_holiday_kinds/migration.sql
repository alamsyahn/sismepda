-- Tiga tipe entri kalender hari libur.
--
-- Entri lama semuanya libur satu tanggal, sehingga default SINGLE membuatnya
-- tetap berperilaku persis seperti sebelumnya. Tidak ada baris yang dihapus.
--
-- `date` dilonggarkan menjadi nullable karena tipe RECURRING tidak terikat pada
-- satu tanggal. Melonggarkan NOT NULL tidak menolak data yang sudah ada.

CREATE TYPE "HolidayKind" AS ENUM ('SINGLE', 'RECURRING', 'SCHOOL_DAY');

ALTER TABLE "SchoolHoliday" ADD COLUMN "kind" "HolidayKind" NOT NULL DEFAULT 'SINGLE';
ALTER TABLE "SchoolHoliday" ADD COLUMN "weekday" INTEGER;
ALTER TABLE "SchoolHoliday" ADD COLUMN "startDate" DATE;
ALTER TABLE "SchoolHoliday" ADD COLUMN "endDate" DATE;

ALTER TABLE "SchoolHoliday" ALTER COLUMN "date" DROP NOT NULL;

-- Unique lama hanya pada tanggal; kini satu tanggal boleh punya satu entri
-- SINGLE dan satu entri SCHOOL_DAY sekaligus, sehingga kuncinya ikut `kind`.
DROP INDEX "SchoolHoliday_date_key";
CREATE UNIQUE INDEX "SchoolHoliday_kind_date_key" ON "SchoolHoliday"("kind", "date");

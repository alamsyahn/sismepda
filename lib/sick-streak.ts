import { addSchoolDays, compareSchoolDates, type SchoolDate } from "@/lib/school-date"

/**
 * Menomori hari ke berapa sebuah tanggal berada dalam rentetan sakitnya.
 *
 * Hari libur sekolah dianggap tidak ada: bila seorang siswa sakit pada 7, 8,
 * dan 10 sementara tanggal 9 terdaftar sebagai hari libur, ketiganya tetap
 * satu rentetan sepanjang 3 hari. Yang dilewati HANYA tanggal yang benar-benar
 * terdaftar pada SchoolHoliday — tidak ada hari yang diperlakukan libur secara
 * hardcode, karena sekolah ini tetap masuk pada hari Sabtu dan kalender
 * liburnya diisi sendiri oleh admin.
 *
 * Konsekuensinya, selama SchoolHoliday masih kosong, rentetan hanya terbentuk
 * dari tanggal kalender yang benar-benar berurutan. Mengisi kalender libur akan
 * menyambung rentetan yang sebelumnya terputus, dan itu memang perilaku yang
 * diminta.
 */

/** Satu baris sakit yang akan diberi nomor rentetan. */
export type SickDay = {
  date: SchoolDate
}

/**
 * Melangkah satu hari sekolah maju dari `date`, melompati setiap tanggal yang
 * terdaftar libur. Berhenti setelah `maxSkips` lompatan supaya rentang libur
 * yang panjang (misalnya libur semester) tidak menyambungkan dua episode sakit
 * yang sebenarnya terpisah, dan supaya kalender libur yang salah isi tidak
 * membuat perulangan berjalan tanpa batas.
 */
function nextSchoolDate(
  date: SchoolDate,
  isHoliday: (value: SchoolDate) => boolean,
  maxSkips: number,
): SchoolDate | null {
  let candidate = addSchoolDays(date, 1)
  for (let skipped = 0; skipped <= maxSkips; skipped += 1) {
    if (!isHoliday(candidate)) return candidate
    candidate = addSchoolDays(candidate, 1)
  }
  return null
}

/** Batas lompatan hari libur berurutan; di atas ini dianggap episode terpisah. */
export const MAX_HOLIDAY_GAP = 30

/**
 * Mengembalikan panjang rentetan untuk setiap tanggal, dengan urutan yang sama
 * seperti masukan. Masukan boleh dalam urutan apa pun dan boleh memuat tanggal
 * kembar; keduanya dinormalkan lebih dulu.
 *
 * Nilai yang dikembalikan adalah POSISI tanggal tersebut di dalam rentetannya,
 * dihitung maju dari hari pertama. Jadi tiga hari berturut-turut menghasilkan
 * 1, 2, 3 — setiap baris menyatakan "ini hari sakit ke berapa" sehingga baris
 * terakhir sekaligus menunjukkan panjang episode yang sedang berjalan.
 */
export function sickStreakLengths(
  days: readonly SickDay[],
  holidays: readonly SchoolDate[],
  maxHolidayGap: number = MAX_HOLIDAY_GAP,
): number[] {
  const holidaySet = new Set<string>(holidays)
  const isHoliday = (value: SchoolDate) => holidaySet.has(value)

  const unique = [...new Set(days.map((day) => day.date))].sort((a, b) =>
    compareSchoolDates(a, b),
  )

  // Nomor urut hari di dalam rentetannya, dihitung maju dari hari pertama.
  const lengthByDate = new Map<string, number>()
  let index = 0
  while (index < unique.length) {
    let end = index
    while (end + 1 < unique.length) {
      const expected = nextSchoolDate(unique[end], isHoliday, maxHolidayGap)
      if (expected === null || expected !== unique[end + 1]) break
      end += 1
    }
    for (let position = index; position <= end; position += 1) {
      lengthByDate.set(unique[position], position - index + 1)
    }
    index = end + 1
  }

  return days.map((day) => lengthByDate.get(day.date) ?? 1)
}

/** Ambang penandaan warna pada kolom rentetan. */
export type StreakTone = "none" | "warning" | "danger"

/**
 * Ambang dibaca dari nomor hari pada baris itu sendiri, sehingga warna baru
 * muncul saat rentetan benar-benar sudah mencapai panjang tersebut. Hari
 * pertama tidak ditandai sama sekali — itu kejadian biasa dan mewarnainya hanya
 * menambah bising. Hari ketiga dan seterusnya ditandai merah karena sudah
 * pantas ditindaklanjuti; hari kedua diberi penanda lebih lembut sebagai
 * peringatan dini.
 */
export function streakTone(dayNumber: number): StreakTone {
  if (dayNumber >= 3) return "danger"
  if (dayNumber === 2) return "warning"
  return "none"
}

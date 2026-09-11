import { prisma } from "@/lib/prisma"
import {
  fromNullablePrismaDate,
  type SchoolDate,
} from "@/lib/school-date"
import {
  holidayNameFor,
  isWeekdayIndex,
  resolveHoliday,
  type HolidayRule,
} from "@/lib/holiday-rules"

/**
 * Semua entri kalender libur, siap dievaluasi oleh `lib/holiday-rules.ts`.
 *
 * Aturan berulang tidak dapat disaring lewat rentang tanggal di SQL, dan
 * jumlah entri kalender sekolah sangat kecil, sehingga seluruh daftar dibaca
 * lalu dievaluasi di aplikasi. Ini juga menjaga ketiga tipe dinilai oleh satu
 * potong logika yang sama di mana pun dipakai.
 */
export async function readHolidayRules(): Promise<HolidayRule[]> {
  const rows = await prisma.schoolHoliday.findMany({ orderBy: { date: "asc" } })
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    date: fromNullablePrismaDate(row.date),
    weekday: isWeekdayIndex(row.weekday) ? row.weekday : null,
    startDate: fromNullablePrismaDate(row.startDate),
    endDate: fromNullablePrismaDate(row.endDate),
  }))
}

/** Nama hari libur untuk satu tanggal, atau `null` bila hari masuk. */
export async function readHolidayFor(date: SchoolDate): Promise<{ name: string } | null> {
  const name = holidayNameFor(date, await readHolidayRules())
  return name === null ? null : { name }
}

/** Tanggal libur di antara `dates`, setelah hari masuk khusus diperhitungkan. */
export async function readHolidayDates(
  dates: readonly SchoolDate[],
): Promise<Map<SchoolDate, string>> {
  const rules = await readHolidayRules()
  const result = new Map<SchoolDate, string>()
  for (const date of dates) {
    const verdict = resolveHoliday(date, rules)
    if (verdict.isHoliday) result.set(date, verdict.reason)
  }
  return result
}

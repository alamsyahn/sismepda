/**
 * Konstanta dan fungsi murni modul Jadwal yang dipakai BERSAMA klien dan server.
 *
 * CLIENT-SAFE: tidak mengimpor Prisma, sesi, maupun modul `lib/server-*`.
 * Komponen klien boleh mengimpor berkas ini sebagai value (lihat catatan
 * boundary bundel di docs/architecture/overview.md).
 */

/** Hari sekolah. 1 = Senin .. 7 = Minggu, sama dengan `TeachingAssignment.day`. */
export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

export type Weekday = (typeof ALL_WEEKDAYS)[number]

/**
 * Hari yang menjadi NILAI AWAL konfigurasi profil waktu (Senin–Sabtu).
 *
 * Ini bukan daftar tertutup: hari aktif sebuah profil dibaca dari database
 * (`ScheduleProfileDay`), dan daftar ini hanya dipakai saat sebuah profil belum
 * pernah dikonfigurasi sama sekali.
 */
export const SCHEDULE_DAYS = [1, 2, 3, 4, 5, 6] as const

export type ScheduleDay = Weekday

export const SCHEDULE_DAY_LABELS: Record<Weekday, string> = {
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
  7: "Minggu",
}

export const SCHEDULE_DAY_SHORT_LABELS: Record<Weekday, string> = {
  1: "Sen",
  2: "Sel",
  3: "Rab",
  4: "Kam",
  5: "Jum",
  6: "Sab",
  7: "Min",
}

export function isScheduleDay(value: unknown): value is ScheduleDay {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7
}

/** Label hari; nilai di luar Senin–Minggu tidak pernah dikarang menjadi hari sekolah. */
export function scheduleDayLabel(day: number): string {
  return isScheduleDay(day) ? SCHEDULE_DAY_LABELS[day] : `Hari ${day}`
}

/**
 * Hari sekolah untuk sebuah tanggal (`YYYY-MM-DD`).
 *
 * Minggu tidak punya jadwal; pemanggil memutuskan sendiri apa yang ditampilkan
 * (`null` berarti "bukan hari sekolah"), bukan diam-diam digeser ke Senin.
 *
 * Sebuah profil TEKNISNYA boleh mengaktifkan hari Minggu (`isScheduleDay(7)`),
 * tetapi "hari ini" tetap tidak dikarang menjadi hari sekolah di sini —
 * mengubahnya akan mengubah perilaku sorotan "Hari ini" pada seluruh modul.
 */
export function scheduleDayFromSchoolDate(value: string): ScheduleDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const weekday = date.getUTCDay() // 0 = Minggu
  return weekday === 0 ? null : (weekday as ScheduleDay)
}

/** Jenis baris pada struktur waktu harian. Cerminan enum Prisma `ScheduleSlotKind`. */
export const SCHEDULE_SLOT_KINDS = ["PELAJARAN", "ISTIRAHAT", "KEGIATAN"] as const

export type ScheduleSlotKind = (typeof SCHEDULE_SLOT_KINDS)[number]

export const SCHEDULE_SLOT_KIND_LABELS: Record<ScheduleSlotKind, string> = {
  PELAJARAN: "Pelajaran",
  ISTIRAHAT: "Istirahat",
  KEGIATAN: "Kegiatan",
}

export function isScheduleSlotKind(value: unknown): value is ScheduleSlotKind {
  return typeof value === "string" && (SCHEDULE_SLOT_KINDS as readonly string[]).includes(value)
}

/** Menit dalam sehari: 0 (00:00) sampai 1439 (23:59). */
export const MINUTES_PER_DAY = 24 * 60

export function isMinuteOfDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MINUTES_PER_DAY
}

/**
 * "HH:MM" → menit sejak tengah malam, atau `null` bila bukan jam yang sah.
 *
 * Sengaja tidak memakai `Date`: nilai ini adalah jam dinding sekolah tanpa
 * tanggal, sehingga melibatkan `Date` hanya akan menyeret zona waktu ke dalam
 * data yang tidak memilikinya.
 */
export function parseTimeOfDay(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** Menit sejak tengah malam → "HH.MM" (format jam Indonesia). */
export function formatMinuteOfDay(minute: number): string {
  if (!isMinuteOfDay(minute)) return "-"
  const hour = Math.floor(minute / 60)
  const rest = minute % 60
  return `${String(hour).padStart(2, "0")}.${String(rest).padStart(2, "0")}`
}

/** Nilai untuk `<input type="time">`, yang selalu memakai titik dua. */
export function toTimeInputValue(minute: number): string {
  if (!isMinuteOfDay(minute)) return ""
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

export function formatTimeRange(startMinute: number, endMinute: number): string {
  return `${formatMinuteOfDay(startMinute)}–${formatMinuteOfDay(endMinute)}`
}

export type MatrixStatus = "HADIR" | "SAKIT" | "IZIN" | "ALFA" | "DISPENSASI" | "NOT_SUBMITTED" | "HOLIDAY"
export type AttendanceRecord = { studentId: string; date: Date; status: Exclude<MatrixStatus, "NOT_SUBMITTED" | "HOLIDAY"> }
export type ClassRecapStudent = { id: string; nis: string | null; nisn: string | null; name: string }

function strictDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  const date = new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000)
  return date
}

const jakartaDateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
})

export function localDateKey(date: Date) {
  const parts = Object.fromEntries(jakartaDateParts.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function parseClassRecapRange(fromValue: string, toValue: string):
  | { ok: true; from: Date; to: Date; dates: Date[] }
  | { ok: false; error: string } {
  const from = strictDate(fromValue)
  const to = strictDate(toValue)
  if (!from || !to) return { ok: false, error: "Tanggal tidak valid" }
  if (from > to) return { ok: false, error: "Tanggal mulai tidak boleh setelah tanggal akhir" }
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
  if (days > 31) return { ok: false, error: "Rentang maksimal 31 hari" }
  const dates = Array.from({ length: days }, (_, index) => {
    return new Date(from.getTime() + index * 86_400_000)
  })
  return { ok: true, from, to, dates }
}

export function statusCode(status: MatrixStatus) {
  return ({ HADIR: "—", SAKIT: "S", IZIN: "I", ALFA: "A", DISPENSASI: "D", NOT_SUBMITTED: "·", HOLIDAY: "L" } as const)[status]
}

export function matrixStatusLabel(status: MatrixStatus) {
  return ({ HADIR: "Hadir", SAKIT: "Sakit", IZIN: "Izin", ALFA: "Alfa", DISPENSASI: "Dispensasi", NOT_SUBMITTED: "Belum diinput", HOLIDAY: "Hari libur" } as const)[status]
}

export function buildClassRecap(input: {
  students: ClassRecapStudent[]
  dates: Date[]
  holidays: Set<string>
  submittedDates: Set<string>
  records: AttendanceRecord[]
}) {
  const recordMap = new Map(input.records.map((record) => [`${record.studentId}:${localDateKey(record.date)}`, record.status]))
  const rows = input.students.map((student) => {
    const counts = { hadir: 0, sakit: 0, izin: 0, dispensasi: 0, alfa: 0 }
    const statuses = input.dates.map((date): MatrixStatus => {
      const key = localDateKey(date)
      if (input.holidays.has(key)) return "HOLIDAY"
      if (!input.submittedDates.has(key)) return "NOT_SUBMITTED"
      const status = recordMap.get(`${student.id}:${key}`) ?? "HADIR"
      counts[status.toLowerCase() as keyof typeof counts] += 1
      return status
    })
    const totalAbsent = counts.sakit + counts.izin + counts.dispensasi + counts.alfa
    return { ...student, statuses, codes: statuses.map(statusCode), counts, totalAbsent }
  })
  const cumulativeRows = [...rows].sort((a, b) => b.totalAbsent - a.totalAbsent || a.name.localeCompare(b.name, "id"))
  const schoolDayCount = input.dates.filter((date) => !input.holidays.has(localDateKey(date))).length
  const submittedDayCount = input.dates.filter((date) => {
    const key = localDateKey(date)
    return !input.holidays.has(key) && input.submittedDates.has(key)
  }).length
  return { rows, cumulativeRows, schoolDayCount, submittedDayCount }
}

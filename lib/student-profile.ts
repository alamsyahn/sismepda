export type StudentAttendanceStatus = "HADIR" | "SAKIT" | "IZIN" | "ALFA" | "DISPENSASI"

export type StudentAttendancePoint = {
  date: Date
  status: StudentAttendanceStatus
}

const monthFormatter = new Intl.DateTimeFormat("id-ID", { month: "short" })

function localMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function summarizeStudentAttendance(records: StudentAttendancePoint[], now = new Date()) {
  const sorted = [...records].sort((a, b) => a.date.getTime() - b.date.getTime())
  const counts = { hadir: 0, sakit: 0, izin: 0, dispensasi: 0, alfa: 0 }
  const months = new Map<string, { key: string; label: string; hadir: number; tidakHadir: number }>()

  for (const record of sorted) {
    const status = record.status.toLowerCase() as keyof typeof counts
    counts[status] += 1
    const key = localMonthKey(record.date)
    const month = months.get(key) ?? {
      key,
      label: monthFormatter.format(record.date).replace(".", ""),
      hadir: 0,
      tidakHadir: 0,
    }
    if (record.status === "HADIR") month.hadir += 1
    else month.tidakHadir += 1
    months.set(key, month)
  }

  let currentPresentStreak = 0
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].status !== "HADIR") break
    currentPresentStreak += 1
  }

  const lastAlfaDate = [...sorted].reverse().find((record) => record.status === "ALFA")?.date ?? null
  const currentMonth = localMonthKey(now)
  const currentMonthAbsences = sorted.filter(
    (record) => localMonthKey(record.date) === currentMonth && record.status !== "HADIR",
  ).length
  const total = sorted.length

  return {
    counts,
    total,
    attendanceRate: total > 0 ? Math.round((counts.hadir / total) * 100) : 0,
    currentPresentStreak,
    lastAlfaDate,
    currentMonthAbsences,
    monthlyTrend: [...months.values()],
  }
}

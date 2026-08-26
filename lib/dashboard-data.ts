export type AttendanceStatus = "hadir" | "sakit" | "izin" | "alfa" | "dispensasi"

export type ClassRecord = {
  id: string
  name: string
  grade: "VII" | "VIII" | "IX"
  homeroom: string
  totalStudents: number
  hadir: number
  sakit: number
  izin: number
  alfa: number
  dispensasi: number
  submitted: boolean
  submittedAt: string | null
  onTime: boolean | null
  previousHadir: number
  previousTotal: number
}

export type AbsenceHistory = {
  sakit: number
  izin: number
  alfa: number
  dispensasi: number
}

export type AbsentStudent = {
  id: string
  nis: string | null
  nisn: string | null
  name: string
  className: string
  status: Exclude<AttendanceStatus, "hadir">
  note: string
  history: AbsenceHistory
}

export type ActivityItem = {
  id: string
  teacher: string
  className: string
  action: string
  time: string
  type: "input" | "edit" | "reminder"
}

const grades = ["VII", "VIII", "IX"] as const

export function computeSummary(records: ClassRecord[]) {
  const totalClasses = records.length
  const submitted = records.filter((c) => c.submitted)
  const notSubmitted = records.filter((c) => !c.submitted)

  const totalHadir = records.reduce((sum, c) => sum + c.hadir, 0)
  const totalSakit = records.reduce((sum, c) => sum + c.sakit, 0)
  const totalIzin = records.reduce((sum, c) => sum + c.izin, 0)
  const totalAlfa = records.reduce((sum, c) => sum + c.alfa, 0)
  const totalDispensasi = records.reduce((sum, c) => sum + c.dispensasi, 0)

  // Only count students in submitted classes for attendance ratio
  const totalPresentEligible = submitted.reduce((sum, c) => sum + c.totalStudents, 0)
  const attendanceRate =
    totalPresentEligible > 0 ? Math.round((totalHadir / totalPresentEligible) * 100) : 0

  const totalStudentsAll = records.reduce((sum, c) => sum + c.totalStudents, 0)
  const previousHadir = records.reduce((sum, c) => sum + c.previousHadir, 0)
  const previousTotal = records.reduce((sum, c) => sum + c.previousTotal, 0)
  const previousAttendanceRate = previousTotal > 0 ? Math.round((previousHadir / previousTotal) * 100) : null
  const attendanceDelta = previousAttendanceRate === null ? null : attendanceRate - previousAttendanceRate
  const onTimeCount = submitted.filter((record) => record.onTime).length

  return {
    totalClasses,
    submittedCount: submitted.length,
    notSubmittedCount: notSubmitted.length,
    totalHadir,
    totalSakit,
    totalIzin,
    totalAlfa,
    totalDispensasi,
    attendanceRate,
    totalStudentsAll,
    completionRate: totalClasses > 0 ? Math.round((submitted.length / totalClasses) * 100) : 0,
    onTimeCount,
    previousAttendanceRate,
    attendanceDelta,
  }
}

export const grades_list = grades

export type StudentRow = {
  id: string
  nis: string | null
  nisn: string | null
  name: string
  className: string
  grade: (typeof grades)[number]
  // rekap selama 20 hari sekolah
  hadir: number
  sakit: number
  izin: number
  dispensasi: number
  alfa: number
  todayStatus: AttendanceStatus | null
}

export const statusMeta: Record<
  AttendanceStatus,
  { label: string; token: string; badge: string }
> = {
  hadir: { label: "Hadir", token: "var(--chart-1)", badge: "bg-[var(--chart-1)]/12 text-[var(--chart-1)]" },
  sakit: { label: "Sakit", token: "var(--chart-4)", badge: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  izin: { label: "Izin", token: "var(--chart-2)", badge: "bg-[var(--chart-2)]/12 text-[var(--chart-2)]" },
  dispensasi: { label: "Dispensasi", token: "var(--chart-6)", badge: "bg-[var(--chart-6)]/15 text-[var(--chart-6)]" },
  alfa: { label: "Alfa", token: "var(--chart-5)", badge: "bg-[var(--chart-5)]/12 text-[var(--chart-5)]" },
}

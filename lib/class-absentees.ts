import { statusMeta, type AbsentStudent, type AttendanceStatus } from "@/lib/dashboard-data"

export type AbsentStatus = Exclude<AttendanceStatus, "hadir">

/** Urutan tampil: yang paling butuh tindak lanjut lebih dulu. */
export const ABSENT_STATUS_ORDER: AbsentStatus[] = ["alfa", "izin", "sakit", "dispensasi"]

export type AbsenteeGroup = {
  status: AbsentStatus
  label: string
  students: AbsentStudent[]
}

export function indexAbsenteesByClass(students: AbsentStudent[]): Map<string, AbsentStudent[]> {
  const byClass = new Map<string, AbsentStudent[]>()
  for (const student of students) {
    if (!student.classId) continue
    const list = byClass.get(student.classId)
    if (list) list.push(student)
    else byClass.set(student.classId, [student])
  }
  return byClass
}

export function groupAbsentees(students: AbsentStudent[]): AbsenteeGroup[] {
  return ABSENT_STATUS_ORDER.map((status) => ({
    status,
    label: statusMeta[status].label,
    students: students
      .filter((student) => student.status === status)
      .sort((a, b) => a.name.localeCompare(b.name, "id")),
  })).filter((group) => group.students.length > 0)
}

export function countAbsenteesByStatus(students: AbsentStudent[]): Record<AbsentStatus, number> {
  const counts: Record<AbsentStatus, number> = { alfa: 0, izin: 0, sakit: 0, dispensasi: 0 }
  for (const student of students) counts[student.status] += 1
  return counts
}

export function filterAbsenteesByStatuses(
  students: AbsentStudent[],
  statuses: ReadonlySet<AbsentStatus>,
): AbsentStudent[] {
  return students.filter((student) => statuses.has(student.status))
}

/**
 * Konteks singkat untuk siswa yang berulang kali absen dengan status yang sama.
 * Mengembalikan null ketika ini kejadian pertama supaya daftar tidak berisik.
 */
export function repeatedAbsenceLabel(student: AbsentStudent): string | null {
  const total = student.history[student.status]
  if (!total || total < 2) return null
  return `${total}× ${statusMeta[student.status].label.toLowerCase()} tercatat`
}

export function absenteeSummaryLabel(students: AbsentStudent[]): string {
  return students.length === 0
    ? "Semua siswa hadir"
    : `${students.length} siswa tidak hadir`
}

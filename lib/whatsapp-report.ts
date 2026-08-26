import type { AttendanceStatus } from "@/app/generated/prisma/client"

export type WhatsAppReportStudent = {
  id: string
  name: string
  status: Exclude<AttendanceStatus, "HADIR"> | null
}

export type WhatsAppReportClass = {
  id: string
  name: string
  grade: string
  submitted: boolean
  students: WhatsAppReportStudent[]
}

const statusSymbols: Record<Exclude<AttendanceStatus, "HADIR">, string> = {
  SAKIT: "S",
  IZIN: "I",
  ALFA: "A",
  DISPENSASI: "D",
}

const gradeLabels: Record<string, string> = {
  VII: "7",
  VIII: "8",
  IX: "9",
  "7": "7",
  "8": "8",
  "9": "9",
}

export function reportClassName(name: string): string {
  const match = name.trim().match(/^(VIII|VII|IX|7|8|9)\s*(.*)$/i)
  if (!match) return name.trim()
  const grade = gradeLabels[match[1].toUpperCase()] ?? match[1]
  return `${grade}${match[2].trim()}`
}

function gradeLabel(grade: string): string {
  return gradeLabels[grade.trim().toUpperCase()] ?? grade.trim()
}

export function buildStudentAttendanceReport(
  dateLabel: string,
  classes: WhatsAppReportClass[],
  includeUnfilled = true,
): string {
  const sections = classes.map((schoolClass) => {
    const header = `*Kelas ${reportClassName(schoolClass.name)}*`
    const uniqueStudents = [...new Map(schoolClass.students.map((student) => [student.id, student])).values()]
    const hasUnfilledStudents = uniqueStudents.some((student) => student.status === null)
    const visibleStudents = includeUnfilled
      ? uniqueStudents
      : uniqueStudents.filter((student) => student.status !== null)
    const rows = visibleStudents.map(
      (student, index) => `${index + 1}. ${student.name} (${student.status ? statusSymbols[student.status] : "?"})`,
    )
    const studentList = rows.length > 0
      ? `\n\n${rows.join("\n")}`
      : hasUnfilledStudents
        ? ""
        : "\nNIHIL"
    const incompleteNotice = !includeUnfilled && hasUnfilledStudents
      ? "\nPengisian belum lengkap."
      : ""
    return `${header}${studentList}${incompleteNotice}`
  })

  return [`*Rekap Absensi Siswa*`, `*${dateLabel}*`, "", sections.join("\n\n")]
    .join("\n")
    .trimEnd()
}

export function buildClassesNotSubmittedReport(
  dateLabel: string,
  classes: WhatsAppReportClass[],
): string {
  const gradeOrder = ["VII", "VIII", "IX"]
  const sections = gradeOrder.map((grade) => {
    const incompleteClasses = classes.flatMap((schoolClass) => {
      if (gradeLabel(schoolClass.grade) !== gradeLabel(grade)) return []
      const unfilledCount = new Set(
        schoolClass.students
          .filter((student) => student.status === null)
          .map((student) => student.id),
      ).size
      if (schoolClass.submitted && unfilledCount === 0) return []
      return [{ schoolClass, unfilledCount }]
    })
    const header = `*Kelas ${gradeLabel(grade)}*`
    if (incompleteClasses.length === 0) return `${header}\nSudah Input Semua`

    const rows = incompleteClasses.map(
      ({ schoolClass, unfilledCount }, index) =>
        `${index + 1}. Kelas ${reportClassName(schoolClass.name)} ${
          schoolClass.submitted ? `kurang ${unfilledCount} siswa` : "belum input"
        }`,
    )
    return `${header}\n\n${rows.join("\n")}`
  })

  return [`*Kelas Belum Input*`, `*${dateLabel}*`, "", sections.join("\n\n")]
    .join("\n")
    .trimEnd()
}

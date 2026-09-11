import { prisma } from "@/lib/prisma"
import type { EuksStudentOption, HealthMeasurement } from "@/lib/euks"
import { fromPrismaDate } from "@/lib/school-date"

export type EuksVisitRow = {
  id: string
  studentId: string
  studentName: string
  className: string
  occurredAt: Date
  complaint: string
  treatment: string
  followUp: string | null
  recordedByName: string | null
}

/** Newest visits first; the table shows the whole log. */
export async function readEuksVisits(): Promise<EuksVisitRow[]> {
  const visits = await prisma.euksVisit.findMany({
    select: {
      id: true,
      studentId: true,
      occurredAt: true,
      complaint: true,
      treatment: true,
      followUp: true,
      student: { select: { name: true, schoolClass: { select: { name: true } } } },
      recordedBy: { select: { name: true } },
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  })

  return visits.map((visit) => ({
    id: visit.id,
    studentId: visit.studentId,
    studentName: visit.student.name,
    className: visit.student.schoolClass.name,
    occurredAt: visit.occurredAt,
    complaint: visit.complaint,
    treatment: visit.treatment,
    followUp: visit.followUp,
    recordedByName: visit.recordedBy?.name ?? null,
  }))
}

/** Active students for the visit form and selector, grouped by class name. */
export async function readEuksStudentOptions(): Promise<Array<EuksStudentOption & { classId: string }>> {
  const students = await prisma.student.findMany({
    where: { active: true },
    select: { id: true, name: true, classId: true, schoolClass: { select: { name: true } } },
    orderBy: [{ schoolClass: { name: "asc" } }, { name: "asc" }],
  })

  return students.map((student) => ({
    id: student.id,
    name: student.name,
    classId: student.classId,
    className: student.schoolClass.name,
  }))
}

export type EuksClassOption = { id: string; name: string }

/** Classes for the "kelas" selector on the monitoring page. */
export async function readEuksClassOptions(): Promise<EuksClassOption[]> {
  const classes = await prisma.schoolClass.findMany({
    select: { id: true, name: true },
    orderBy: [{ grade: "asc" }, { name: "asc" }],
  })
  return classes
}

export type SickAbsenceRow = {
  id: string
  date: Date
  note: string | null
}

export type StudentMonitoringData = {
  student: {
    id: string
    name: string
    className: string
    birthDate: string | null
    gender: "LAKI_LAKI" | "PEREMPUAN" | null
  }
  measurements: HealthMeasurement[]
  sickAbsences: SickAbsenceRow[]
  visits: EuksVisitRow[]
}

/**
 * Everything the monitoring page shows for one student. The sick-absence and
 * visit tables are read-only projections of existing Attendance and EuksVisit
 * data — E-UKS never copies student data into its own tables.
 */
export async function readStudentMonitoring(studentId: string): Promise<StudentMonitoringData | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      birthDate: true,
      gender: true,
      schoolClass: { select: { name: true } },
    },
  })
  if (!student) return null

  const [measurements, absences, visits] = await Promise.all([
    prisma.studentHealthMeasurement.findMany({
      where: { studentId },
      select: { id: true, measuredAt: true, heightCm: true, weightKg: true, note: true },
      orderBy: { measuredAt: "desc" },
    }),
    prisma.attendance.findMany({
      where: { studentId, status: "SAKIT" },
      select: { id: true, note: true, attendanceDay: { select: { date: true } } },
      orderBy: { attendanceDay: { date: "desc" } },
    }),
    prisma.euksVisit.findMany({
      where: { studentId },
      select: {
        id: true,
        studentId: true,
        occurredAt: true,
        complaint: true,
        treatment: true,
        followUp: true,
        recordedBy: { select: { name: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    }),
  ])

  return {
    student: {
      id: student.id,
      name: student.name,
      className: student.schoolClass.name,
      birthDate: student.birthDate ? fromPrismaDate(student.birthDate) : null,
      gender: student.gender,
    },
    // Decimal must not cross the server/client boundary as a Prisma object.
    measurements: measurements.map((item) => ({
      id: item.id,
      measuredAt: fromPrismaDate(item.measuredAt),
      heightCm: Number(item.heightCm),
      weightKg: Number(item.weightKg),
      note: item.note,
    })),
    sickAbsences: absences.map((item) => ({ id: item.id, date: item.attendanceDay.date, note: item.note })),
    visits: visits.map((visit) => ({
      id: visit.id,
      studentId: visit.studentId,
      studentName: student.name,
      className: student.schoolClass.name,
      occurredAt: visit.occurredAt,
      complaint: visit.complaint,
      treatment: visit.treatment,
      followUp: visit.followUp,
      recordedByName: visit.recordedBy?.name ?? null,
    })),
  }
}

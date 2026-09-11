import { prisma } from "@/lib/prisma"
import type { EuksStudentOption } from "@/lib/euks"

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

/** Active students for the visit form, grouped by class name. */
export async function readEuksStudentOptions(): Promise<EuksStudentOption[]> {
  const students = await prisma.student.findMany({
    where: { active: true },
    select: { id: true, name: true, schoolClass: { select: { name: true } } },
    orderBy: [{ schoolClass: { name: "asc" } }, { name: "asc" }],
  })

  return students.map((student) => ({
    id: student.id,
    name: student.name,
    className: student.schoolClass.name,
  }))
}

import { prisma } from "@/lib/prisma"
import { compareClassNames } from "@/lib/class-order"
import { groupScheduleByDay, summarizeTeachingLoad } from "@/lib/teacher-profile"

/** Photo URL scoped to a specific teacher (not the signed-in user). */
export function teacherPhotoUrl(teacherId: string, updatedAt: Date | null) {
  return updatedAt ? `/api/teachers/${teacherId}/photo?v=${updatedAt.getTime()}` : null
}

export async function readTeacherProfile(teacherId: string) {
  const teacher = await prisma.user.findFirst({
    where: { id: teacherId, role: { in: ["ADMIN", "GURU"] } },
    select: {
      id: true,
      name: true,
      nip: true,
      email: true,
      phone: true,
      role: true,
      active: true,
      photoUpdatedAt: true,
      employmentStatus: true,
      position: true,
      teachingSince: true,
      belajarId: true,
      canManageTeacherProfiles: true,
      homeroomClass: { select: { name: true } },
      teacherSubjects: { select: { subject: { select: { id: true, name: true } } } },
      additionalDuties: {
        select: { id: true, title: true, note: true, startDate: true },
        orderBy: { title: "asc" },
      },
      teachingAssignments: {
        select: {
          id: true,
          day: true,
          periodStart: true,
          periodEnd: true,
          schoolClass: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
        },
        orderBy: [{ day: "asc" }, { periodStart: "asc" }],
      },
    },
  })
  if (!teacher) return null

  const assignments = teacher.teachingAssignments
  const classSubjects = new Map<string, { className: string; subjects: Set<string> }>()
  for (const item of assignments) {
    const entry = classSubjects.get(item.schoolClass.id) ?? { className: item.schoolClass.name, subjects: new Set<string>() }
    entry.subjects.add(item.subject.name)
    classSubjects.set(item.schoolClass.id, entry)
  }

  return {
    teacher: {
      ...teacher,
      photoUrl: teacherPhotoUrl(teacher.id, teacher.photoUpdatedAt),
      subjects: teacher.teacherSubjects.map((item) => item.subject),
    },
    schedule: groupScheduleByDay(assignments),
    load: summarizeTeachingLoad(assignments),
    classSubjects: [...classSubjects.values()]
      .map((item) => ({ className: item.className, subjects: [...item.subjects].sort() }))
      .sort((a, b) => compareClassNames(a.className, b.className)),
  }
}

export async function readTeacherDirectory() {
  const teachers = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "GURU"] } },
    select: {
      id: true,
      name: true,
      nip: true,
      email: true,
      phone: true,
      active: true,
      employmentStatus: true,
      position: true,
      teachingSince: true,
      homeroomClass: { select: { name: true } },
      teacherSubjects: { select: { subject: { select: { name: true } } } },
      _count: { select: { teachingAssignments: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  })

  return teachers.map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    nip: teacher.nip,
    email: teacher.email,
    phone: teacher.phone,
    active: teacher.active,
    employmentStatus: teacher.employmentStatus,
    position: teacher.position,
    teachingSince: teacher.teachingSince,
    homeroom: teacher.homeroomClass?.name ?? null,
    subjects: teacher.teacherSubjects.map((item) => item.subject.name).sort(),
    scheduleCount: teacher._count.teachingAssignments,
  }))
}

export async function readSubjectsAndClasses() {
  const [subjects, classes] = await Promise.all([
    prisma.subject.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.schoolClass.findMany({ select: { id: true, name: true } }),
  ])
  return { subjects, classes: classes.sort((a, b) => compareClassNames(a.name, b.name)) }
}

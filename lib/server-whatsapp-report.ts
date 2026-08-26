import { requireUser } from "@/lib/auth-guards"
import { sortClasses } from "@/lib/class-order"
import { prisma } from "@/lib/prisma"
import type { WhatsAppReportClass, WhatsAppReportStudent } from "@/lib/whatsapp-report"

export async function getWhatsAppReportClasses(date: Date): Promise<WhatsAppReportClass[]> {
  await requireUser()

  const rows = await prisma.schoolClass.findMany({
    select: {
      id: true,
      name: true,
      grade: true,
      students: {
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
      attendanceDays: {
        where: { date },
        take: 1,
        select: {
          attendances: {
            select: { studentId: true, status: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  })

  return sortClasses(rows).map((schoolClass) => {
    const day = schoolClass.attendanceDays[0]
    const attendanceByStudent = new Map(
      day?.attendances.map((attendance) => [attendance.studentId, attendance.status]) ?? [],
    )
    const students: WhatsAppReportStudent[] = schoolClass.students.flatMap((student) => {
      const status = attendanceByStudent.get(student.id)
      if (status === "HADIR") return []
      return [{ id: student.id, name: student.name, status: status ?? null }]
    })

    return {
      id: schoolClass.id,
      name: schoolClass.name,
      grade: schoolClass.grade,
      submitted: Boolean(day),
      students,
    }
  })
}

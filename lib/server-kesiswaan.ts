import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/api-errors"
import { activityScope, type KsViewer } from "@/lib/kesiswaan-access"
import { schoolDateFromInstant } from "@/lib/school-date"

type Serialized<T> = T extends string
  ? string
  : T extends Date
    ? string
    : T extends Array<infer U>
      ? Serialized<U>[]
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T

export async function readKesiswaan(viewer: KsViewer, periodId?: string) {
  return prisma.$transaction(
    async (tx) => {
      const settings = await tx.schoolSetting.findFirst({
        select: {
          schoolName: true,
          academicYear: true,
          semester: true,
          timeZone: true,
          npsn: true,
        },
      })
      const periods = await tx.ksPeriod.findMany({ orderBy: { start: "desc" } })
      const period = periodId
        ? periods.find((p) => p.id === periodId)
        : (periods.find(
            (p) => p.year === settings?.academicYear && p.semester === settings?.semester,
          ) ?? periods[0])
      if (periodId && !period) throw new ApiError(404, "Periode tidak ditemukan")
      const where = { periodId: period?.id ?? "__empty__", ...activityScope(viewer) }
      const activities = await tx.ksActivity.findMany({
        where,
        orderBy: { name: "asc" },
        include: {
          coaches: { include: { user: { select: { id: true, name: true } } } },
          members: {
            include: { student: { select: { id: true, name: true, active: true } }, reviews: true },
            orderBy: { student: { name: "asc" } },
          },
          sessions: {
            include: { attendance: { orderBy: { studentName: "asc" } } },
            orderBy: { date: "desc" },
          },
          followups: { orderBy: { due: "asc" } },
        },
      })
      const achievements = await tx.ksAchievement.findMany({
        where: {
          periodId: period?.id ?? "__empty__",
          ...(viewer.all ? {} : { activity: activityScope(viewer) }),
        },
        include: {
          participants: true,
          evidenceFiles: { select: { id: true, name: true, mimeType: true, size: true } },
        },
        orderBy: { date: "desc" },
      })
      const students =
        viewer.write || viewer.manage
          ? await tx.student.findMany({
              where: { active: true },
              select: {
                id: true,
                name: true,
                nis: true,
                nisn: true,
                schoolClass: { select: { name: true } },
              },
              orderBy: { name: "asc" },
            })
          : []
      const teachers = viewer.manage
        ? await tx.user.findMany({
            where: { active: true, isTeacher: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : []
      const studentCount = viewer.all ? await tx.student.count({ where: { active: true } }) : null
      const snapshot = {
        viewer,
        settings,
        today: schoolDateFromInstant(new Date(), settings?.timeZone ?? "Asia/Jakarta"),
        generatedAt: new Date(),
        periods,
        period: period ?? null,
        activities,
        achievements,
        students,
        teachers,
        studentCount,
      }
      return JSON.parse(JSON.stringify(snapshot)) as Serialized<typeof snapshot>
    },
    { isolationLevel: "RepeatableRead" },
  )
}
export type KesiswaanData = Awaited<ReturnType<typeof readKesiswaan>>

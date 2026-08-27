import { prisma } from "@/lib/prisma"
import {
  aggregateWorkbookPercent,
  completionState,
  summarizeWorkbookProgress,
  weightedOverallPercent,
  type CompletionState,
  type WorkbookItemStatus,
} from "@/lib/workbook"

export type WorkbookMasterItem = { id: string; name: string; sortOrder: number }

export type WorkbookMaster = {
  id: string
  number: number
  name: string
  weight: number
  items: WorkbookMasterItem[]
}

export type TeacherWorkbookCell = {
  workbookId: string
  number: number
  url: string | null
  presentCount: number
  missingCount: number
  unreviewedCount: number
  totalCount: number
  percent: number
  state: CompletionState
  items: Array<{ itemId: string; status: WorkbookItemStatus; reviewedBy: string | null; reviewedAt: string | null }>
}

export type TeacherSupervisionRow = {
  id: string
  name: string
  nip: string | null
  active: boolean
  photoUrl: string | null
  workbooks: TeacherWorkbookCell[]
  overallPercent: number
  overallState: CompletionState
  missingLinkCount: number
}

export type WorkbookAggregate = {
  id: string
  number: number
  name: string
  weight: number
  itemCount: number
  percent: number
  completeTeachers: number
  inProgressTeachers: number
  unreviewedTeachers: number
  missingLinkTeachers: number
}

export type SupervisionOverview = {
  workbooks: WorkbookMaster[]
  teachers: TeacherSupervisionRow[]
  aggregates: WorkbookAggregate[]
  overall: {
    percent: number
    completeTeachers: number
    inProgressTeachers: number
    unreviewedTeachers: number
    teacherCount: number
    missingLinkTeachers: number
  }
}

/** Master workbooks with their checklist items, ordered for display. */
export async function readWorkbookMaster(): Promise<WorkbookMaster[]> {
  const workbooks = await prisma.workbook.findMany({
    select: {
      id: true,
      number: true,
      name: true,
      weight: true,
      items: { select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { sortOrder: "asc" },
  })
  return workbooks
}

/**
 * Whole supervision page in three flat queries — no per-teacher or per-workbook
 * round trips. Missing status rows are treated as UNREVIEWED.
 */
export async function readSupervisionOverview(): Promise<SupervisionOverview> {
  const [workbooks, teachers, links, statuses] = await Promise.all([
    readWorkbookMaster(),
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "GURU"] }, workbookSupervised: true },
      select: { id: true, name: true, nip: true, active: true, photoUpdatedAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.teacherWorkbook.findMany({ select: { userId: true, workbookId: true, url: true } }),
    prisma.teacherWorkbookItemStatus.findMany({
      select: {
        userId: true,
        workbookItemId: true,
        status: true,
        reviewedAt: true,
        reviewedBy: { select: { name: true } },
      },
    }),
  ])

  const linkByKey = new Map(links.map((link) => [`${link.userId}:${link.workbookId}`, link.url]))
  const statusByKey = new Map(
    statuses.map((status) => [`${status.userId}:${status.workbookItemId}`, status]),
  )

  const rows: TeacherSupervisionRow[] = teachers.map((teacher) => {
    const cells: TeacherWorkbookCell[] = workbooks.map((workbook) => {
      const items = workbook.items.map((item) => {
        const record = statusByKey.get(`${teacher.id}:${item.id}`)
        return {
          itemId: item.id,
          status: (record?.status ?? "UNREVIEWED") as WorkbookItemStatus,
          reviewedBy: record?.reviewedBy?.name ?? null,
          reviewedAt: record?.reviewedAt ? record.reviewedAt.toISOString() : null,
        }
      })
      const progress = summarizeWorkbookProgress(items.map((item) => item.status))
      return {
        workbookId: workbook.id,
        number: workbook.number,
        url: linkByKey.get(`${teacher.id}:${workbook.id}`) ?? null,
        presentCount: progress.presentCount,
        missingCount: progress.missingCount,
        unreviewedCount: progress.unreviewedCount,
        totalCount: progress.totalCount,
        percent: progress.percent,
        state: progress.state,
        items,
      }
    })

    const overallPercent = weightedOverallPercent(
      cells.map((cell, index) => ({ percent: cell.percent, weight: workbooks[index].weight })),
    )
    const totals = cells.reduce(
      (sum, cell) => ({
        present: sum.present + cell.presentCount,
        unreviewed: sum.unreviewed + cell.unreviewedCount,
        total: sum.total + cell.totalCount,
      }),
      { present: 0, unreviewed: 0, total: 0 },
    )

    return {
      id: teacher.id,
      name: teacher.name,
      nip: teacher.nip,
      active: teacher.active,
      photoUrl: teacher.photoUpdatedAt
        ? `/api/teachers/${teacher.id}/photo?v=${teacher.photoUpdatedAt.getTime()}`
        : null,
      workbooks: cells,
      overallPercent,
      overallState: completionState({
        presentCount: totals.present,
        unreviewedCount: totals.unreviewed,
        totalCount: totals.total,
      }),
      missingLinkCount: cells.filter((cell) => !cell.url).length,
    }
  })

  const teacherCount = rows.length
  const aggregates: WorkbookAggregate[] = workbooks.map((workbook, index) => {
    const cells = rows.map((row) => row.workbooks[index])
    const presentCount = cells.reduce((sum, cell) => sum + cell.presentCount, 0)
    return {
      id: workbook.id,
      number: workbook.number,
      name: workbook.name,
      weight: workbook.weight,
      itemCount: workbook.items.length,
      percent: aggregateWorkbookPercent({ presentCount, teacherCount, itemCount: workbook.items.length }),
      completeTeachers: cells.filter((cell) => cell.state === "COMPLETE").length,
      inProgressTeachers: cells.filter((cell) => cell.state === "IN_PROGRESS").length,
      unreviewedTeachers: cells.filter((cell) => cell.state === "UNREVIEWED").length,
      missingLinkTeachers: cells.filter((cell) => !cell.url).length,
    }
  })

  return {
    workbooks,
    teachers: rows,
    aggregates,
    overall: {
      percent: weightedOverallPercent(
        aggregates.map((aggregate) => ({ percent: aggregate.percent, weight: aggregate.weight })),
      ),
      completeTeachers: rows.filter((row) => row.overallState === "COMPLETE").length,
      inProgressTeachers: rows.filter((row) => row.overallState === "IN_PROGRESS").length,
      unreviewedTeachers: rows.filter((row) => row.overallState === "UNREVIEWED").length,
      teacherCount,
      missingLinkTeachers: rows.filter((row) => row.missingLinkCount > 0).length,
    },
  }
}

/** The signed-in teacher's own four workbook links, one row per workbook. */
export async function readOwnWorkbookLinks(userId: string) {
  const [workbooks, links] = await Promise.all([
    prisma.workbook.findMany({
      select: { id: true, number: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.teacherWorkbook.findMany({
      where: { userId },
      select: { workbookId: true, url: true },
    }),
  ])
  const byWorkbook = new Map(links.map((link) => [link.workbookId, link.url]))
  return workbooks.map((workbook) => ({
    workbookId: workbook.id,
    number: workbook.number,
    name: workbook.name,
    url: byWorkbook.get(workbook.id) ?? null,
  }))
}

/** Teachers plus their supervision-scope flag, for the scope management screen. */
export async function readSupervisionScope() {
  const teachers = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "GURU"] } },
    select: {
      id: true,
      name: true,
      nip: true,
      active: true,
      position: true,
      workbookSupervised: true,
      canSuperviseWorkbooks: true,
      canViewWorkbookSupervision: true,
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  })
  return teachers
}

"use client"

import { useMemo, useState } from "react"
import { ExternalLink, Link2Off, Search, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SupervisionDashboard } from "@/components/supervisi/supervision-dashboard"
import { StatusDots, StatusLegend } from "@/components/supervisi/status-icon"
import { WorkbookDetailSheet, type DrawerTarget } from "@/components/supervisi/workbook-detail-sheet"
import { cn } from "@/lib/utils"
import { completionLabels, formatPercent, type CompletionState } from "@/lib/workbook"
import type { SupervisionOverview, TeacherSupervisionRow } from "@/lib/server-workbook"

type StatusFilter = "all" | "complete" | "incomplete" | "unreviewed"
type SortKey = "name-asc" | "name-desc" | "progress-asc" | "progress-desc"

const statusFilterLabels: Record<StatusFilter, string> = {
  all: "Semua",
  complete: "Lengkap",
  incomplete: "Belum Lengkap",
  unreviewed: "Belum Diperiksa",
}

const sortLabels: Record<SortKey, string> = {
  "name-asc": "Nama A-Z",
  "name-desc": "Nama Z-A",
  "progress-asc": "Progress Terendah",
  "progress-desc": "Progress Tertinggi",
}

const stateBadgeVariant: Record<CompletionState, "default" | "secondary" | "outline"> = {
  COMPLETE: "default",
  IN_PROGRESS: "secondary",
  UNREVIEWED: "outline",
}

/** Progress used by filters and sorting: whole teacher, or the selected workbook. */
function scopedProgress(teacher: TeacherSupervisionRow, workbookNumber: number | null) {
  if (workbookNumber === null) {
    return { percent: teacher.overallPercent, state: teacher.overallState }
  }
  const cell = teacher.workbooks.find((item) => item.number === workbookNumber)
  return { percent: cell?.percent ?? 0, state: cell?.state ?? "UNREVIEWED" }
}

export function SupervisionView({
  overview,
  canSupervise,
}: {
  overview: SupervisionOverview
  canSupervise: boolean
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [workbookFilter, setWorkbookFilter] = useState("all")
  const [sort, setSort] = useState<SortKey>("name-asc")
  const [missingLinkOnly, setMissingLinkOnly] = useState(false)
  const [target, setTarget] = useState<DrawerTarget | null>(null)

  const selectedWorkbook = workbookFilter === "all" ? null : Number(workbookFilter)

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const filtered = overview.teachers.filter((teacher) => {
      if (keyword && !teacher.name.toLowerCase().includes(keyword)) return false
      if (missingLinkOnly && teacher.missingLinkCount === 0) return false

      const scoped = scopedProgress(teacher, selectedWorkbook)
      if (status === "complete") return scoped.state === "COMPLETE"
      if (status === "unreviewed") return scoped.state === "UNREVIEWED"
      if (status === "incomplete") return scoped.state === "IN_PROGRESS"
      return true
    })

    return [...filtered].sort((a, b) => {
      if (sort === "name-asc") return a.name.localeCompare(b.name, "id")
      if (sort === "name-desc") return b.name.localeCompare(a.name, "id")
      const left = scopedProgress(a, selectedWorkbook).percent
      const right = scopedProgress(b, selectedWorkbook).percent
      if (left === right) return a.name.localeCompare(b.name, "id")
      return sort === "progress-asc" ? left - right : right - left
    })
  }, [overview.teachers, query, status, selectedWorkbook, sort, missingLinkOnly])

  const visibleWorkbooks = selectedWorkbook
    ? overview.workbooks.filter((workbook) => workbook.number === selectedWorkbook)
    : overview.workbooks

  const hasTeachers = overview.teachers.length > 0

  return (
    <div className="space-y-6">
      <SupervisionDashboard overall={overview.overall} aggregates={overview.aggregates} />

      <Card className="border-border/70">
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_170px_180px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama guru..."
              aria-label="Cari nama guru"
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(value) => value && setStatus(value as StatusFilter)}>
            <SelectTrigger aria-label="Filter status kelengkapan">
              <SelectValue>{(value: StatusFilter) => statusFilterLabels[value] ?? "Semua"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="complete">Lengkap</SelectItem>
              <SelectItem value="incomplete">Belum Lengkap</SelectItem>
              <SelectItem value="unreviewed">Belum Diperiksa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={workbookFilter} onValueChange={(value) => value && setWorkbookFilter(value)}>
            <SelectTrigger aria-label="Filter Buku Kerja">
              <SelectValue>
                {(value: string) =>
                  value === "all"
                    ? "Semua Buku Kerja"
                    : overview.workbooks.find((workbook) => String(workbook.number) === value)?.name ??
                      "Semua Buku Kerja"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Buku Kerja</SelectItem>
              {overview.workbooks.map((workbook) => (
                <SelectItem key={workbook.id} value={String(workbook.number)}>{workbook.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => value && setSort(value as SortKey)}>
            <SelectTrigger aria-label="Urutkan">
              <SelectValue>{(value: SortKey) => sortLabels[value] ?? "Nama A-Z"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Nama A-Z</SelectItem>
              <SelectItem value="name-desc">Nama Z-A</SelectItem>
              <SelectItem value="progress-asc">Progress Terendah</SelectItem>
              <SelectItem value="progress-desc">Progress Tertinggi</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant={missingLinkOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={missingLinkOnly}
          onClick={() => setMissingLinkOnly((current) => !current)}
        >
          <Link2Off className="size-4" />
          Belum memasukkan link: {overview.overall.missingLinkTeachers} guru
        </Button>
        <StatusLegend />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">No</TableHead>
                  <TableHead className="min-w-52">Nama Lengkap Guru</TableHead>
                  {visibleWorkbooks.map((workbook) => (
                    <TableHead key={workbook.id} className="min-w-40">{workbook.name}</TableHead>
                  ))}
                  <TableHead className="min-w-36">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!hasTeachers ? (
                  <TableRow>
                    <TableCell colSpan={visibleWorkbooks.length + 3} className="h-32 text-center text-muted-foreground">
                      Tidak ada data guru.
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleWorkbooks.length + 3} className="h-32 text-center text-muted-foreground">
                      Tidak ada guru yang sesuai dengan pencarian.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((teacher, index) => (
                    <TableRow key={teacher.id} className={teacher.active ? undefined : "opacity-65"}>
                      <TableCell className="text-center text-sm text-muted-foreground tabular-nums">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {teacher.name}
                        {teacher.active ? null : (
                          <span className="ml-2 text-xs text-muted-foreground">Nonaktif</span>
                        )}
                      </TableCell>

                      {visibleWorkbooks.map((workbook) => {
                        const cell = teacher.workbooks.find((item) => item.number === workbook.number)
                        if (!cell) return <TableCell key={workbook.id}>-</TableCell>
                        return (
                          <TableCell key={workbook.id}>
                            <button
                              type="button"
                              onClick={() => setTarget({ teacherId: teacher.id, workbookNumber: workbook.number })}
                              className="flex w-full flex-col items-start gap-1.5 rounded-lg p-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                              aria-label={`Detail ${workbook.name} ${teacher.name}: ${cell.presentCount} dari ${cell.totalCount} lengkap`}
                            >
                              <span className="flex items-baseline gap-1.5">
                                <span className="text-sm font-semibold text-foreground tabular-nums">
                                  {cell.presentCount} / {cell.totalCount}
                                </span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {formatPercent(cell.percent)}
                                </span>
                              </span>
                              <StatusDots statuses={cell.items.map((item) => item.status)} />
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                {cell.url ? (
                                  <>
                                    <ExternalLink className="size-3" aria-hidden />
                                    Link tersedia
                                  </>
                                ) : (
                                  <>
                                    <Link2Off className="size-3" aria-hidden />
                                    Belum ada link
                                  </>
                                )}
                              </span>
                            </button>
                          </TableCell>
                        )
                      })}

                      <TableCell>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground tabular-nums">
                              {formatPercent(teacher.overallPercent)}
                            </span>
                            <Badge variant={stateBadgeVariant[teacher.overallState]}>
                              {completionLabels[teacher.overallState]}
                            </Badge>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full bg-primary motion-safe:transition-all motion-safe:duration-500",
                              )}
                              style={{ width: `${teacher.overallPercent}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="size-4" />
        Menampilkan {rows.length} dari {overview.teachers.length} guru.
      </p>

      <WorkbookDetailSheet
        target={target}
        onClose={() => setTarget(null)}
        teachers={overview.teachers}
        workbooks={overview.workbooks}
        canSupervise={canSupervise}
      />
    </div>
  )
}

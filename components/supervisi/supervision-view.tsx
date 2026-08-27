"use client"

import { useMemo, useState } from "react"
import { ExternalLink, Link2Off, RotateCcw, Search, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SupervisionDashboard } from "@/components/supervisi/supervision-dashboard"
import { SupervisionBrief } from "@/components/supervisi/supervision-brief"
import { StatusDots, StatusLegend } from "@/components/supervisi/status-icon"
import { WorkbookDetailSheet, type DrawerTarget } from "@/components/supervisi/workbook-detail-sheet"
import { cn } from "@/lib/utils"
import { completionLabels, formatPercent, progressColor, type CompletionState } from "@/lib/workbook"
import type { SupervisionOverview, TeacherSupervisionRow } from "@/lib/server-workbook"
import { ProfileNameLink } from "@/components/profile/profile-name-link"

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
  "progress-asc": "Kelengkapan Terendah",
  "progress-desc": "Kelengkapan Tertinggi",
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
  const hasActiveFilters = query.length > 0 || status !== "all" || workbookFilter !== "all" || sort !== "name-asc" || missingLinkOnly

  function resetFilters() {
    setQuery("")
    setStatus("all")
    setWorkbookFilter("all")
    setSort("name-asc")
    setMissingLinkOnly(false)
  }

  function revealList() {
    requestAnimationFrame(() => document.getElementById("supervision-list-title")?.scrollIntoView({ block: "start" }))
  }

  return (
    <div className="space-y-8">
      <SupervisionBrief
        overall={overview.overall}
        canSupervise={canSupervise}
        onShowUnreviewed={() => {
          setStatus("unreviewed")
          setMissingLinkOnly(false)
          revealList()
        }}
        onShowMissingLinks={() => {
          setMissingLinkOnly(true)
          setStatus("all")
          revealList()
        }}
      />

      <SupervisionDashboard overall={overview.overall} aggregates={overview.aggregates} />

      <section aria-labelledby="supervision-list-title" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="supervision-list-title" className="text-lg font-semibold tracking-tight text-foreground">
              Daftar pemeriksaan guru
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cari guru, batasi buku kerja, lalu buka detail untuk meninjau setiap komponen.
            </p>
          </div>
          <StatusLegend />
        </div>

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
              <SelectItem value="progress-asc">Kelengkapan Terendah</SelectItem>
              <SelectItem value="progress-desc">Kelengkapan Tertinggi</SelectItem>
            </SelectContent>
          </Select>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant={missingLinkOnly ? "default" : "outline"}
            size="lg"
            className="min-h-11 px-4"
            aria-pressed={missingLinkOnly}
            onClick={() => setMissingLinkOnly((current) => !current)}
          >
            <Link2Off className="size-4" />
            Tanpa tautan: {overview.overall.missingLinkTeachers} guru
          </Button>
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" size="lg" className="min-h-11 px-4" onClick={resetFilters}>
              <RotateCcw className="size-4" />
              Atur ulang filter
            </Button>
          ) : null}
        </div>

        <Card className="hidden md:block">
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
                        <ProfileNameLink type="teacher" id={teacher.id} name={teacher.name} />
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
                              className="h-full rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-700 motion-safe:ease-out"
                              style={{
                                width: `${teacher.overallPercent}%`,
                                backgroundColor: progressColor(teacher.overallPercent),
                              }}
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

        <div className="grid gap-3 md:hidden">
          {!hasTeachers ? (
            <EmptyState message="Belum ada guru dalam cakupan supervisi." />
          ) : rows.length === 0 ? (
            <EmptyState message="Tidak ada guru yang cocok dengan filter saat ini." onReset={resetFilters} />
          ) : (
            rows.map((teacher) => (
              <article key={teacher.id} className={cn("rounded-xl bg-card p-4 ring-1 ring-foreground/10", !teacher.active && "opacity-65")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground"><ProfileNameLink type="teacher" id={teacher.id} name={teacher.name} /></h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {teacher.nip ? `NIP ${teacher.nip}` : "NIP belum tersedia"}{teacher.active ? "" : " · Nonaktif"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-foreground tabular-nums">{formatPercent(teacher.overallPercent)}</p>
                    <Badge variant={stateBadgeVariant[teacher.overallState]}>{completionLabels[teacher.overallState]}</Badge>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {visibleWorkbooks.map((workbook) => {
                    const cell = teacher.workbooks.find((item) => item.number === workbook.number)
                    if (!cell) return null
                    return (
                      <button
                        key={workbook.id}
                        type="button"
                        onClick={() => setTarget({ teacherId: teacher.id, workbookNumber: workbook.number })}
                        className="min-h-20 rounded-lg bg-muted/50 p-3 text-left ring-1 ring-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        aria-label={`Detail ${workbook.name} ${teacher.name}: ${cell.presentCount} dari ${cell.totalCount} lengkap`}
                      >
                        <span className="block truncate text-xs font-medium text-muted-foreground">{workbook.name}</span>
                        <span className="mt-1 block text-sm font-semibold tabular-nums">{cell.presentCount}/{cell.totalCount} · {formatPercent(cell.percent)}</span>
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          {cell.url ? <ExternalLink className="size-3" aria-hidden /> : <Link2Off className="size-3" aria-hidden />}
                          {cell.url ? "Tautan tersedia" : "Tanpa tautan"}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </article>
            ))
          )}
        </div>

        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Users className="size-4" />
          Menampilkan {rows.length} dari {overview.teachers.length} guru.
        </p>
      </section>

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

function EmptyState({ message, onReset }: { message: string; onReset?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onReset ? (
        <Button type="button" variant="outline" size="lg" className="mt-4 min-h-11 px-4" onClick={onReset}>
          <RotateCcw className="size-4" />
          Atur ulang filter
        </Button>
      ) : null}
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import {
  UserX,
  Search,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Check,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatLongDate } from "@/lib/date"
import { statusMeta, type AbsentStudent } from "@/lib/dashboard-data"
import {
  filterAbsenteesByStatuses,
  type AbsentStatus,
} from "@/lib/class-absentees"
import { compareClassNames } from "@/lib/class-order"
import { ProfileNameLink } from "@/components/profile/profile-name-link"

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
}

type SortKey = "name" | "nis" | "className" | "status" | "note" | "total" | "riwayat"
type SortDir = "asc" | "desc"
type SortState = { key: SortKey; dir: SortDir }

const PER_PAGE_OPTIONS = [10, 25, 50] as const

const HISTORY_KEYS: AbsentStatus[] = ["sakit", "izin", "alfa", "dispensasi"]

export function AbsentStudentsTable({ students, date }: { students: AbsentStudent[]; date: string }) {
  const [activeStatuses, setActiveStatuses] = useState<Set<AbsentStatus>>(
    () => new Set(HISTORY_KEYS),
  )
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortState>({ key: "total", dir: "desc" })
  const [perPage, setPerPage] = useState<number>(10)
  const [page, setPage] = useState(1)

  const total = (student: AbsentStudent) =>
    HISTORY_KEYS.reduce(
      (sum, status) => sum + (activeStatuses.has(status) ? student.history[status] : 0),
      0,
    )

  const riwayatScore = (student: AbsentStudent) =>
    HISTORY_KEYS.filter((status) => activeStatuses.has(status) && student.history[status] > 0).length

  const statusFiltered = useMemo(
    () => filterAbsenteesByStatuses(students, activeStatuses),
    [students, activeStatuses],
  )

  const searched = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return statusFiltered
    return statusFiltered.filter(
      (student) =>
        student.name.toLowerCase().includes(normalizedQuery) ||
        student.nis?.includes(normalizedQuery) ||
        student.nisn?.includes(normalizedQuery) ||
        student.className.toLowerCase().includes(normalizedQuery),
    )
  }, [statusFiltered, query])

  // 3. Sorting
  const sorted = useMemo(() => {
    const rows = [...searched]
    const byName = (a: AbsentStudent, b: AbsentStudent) => a.name.localeCompare(b.name, "id")

    const dir = sort.dir === "asc" ? 1 : -1
    return rows.sort((a, b) => {
      let cmp = 0
      switch (sort.key) {
        case "name":
          cmp = byName(a, b)
          break
        case "nis":
          cmp = (a.nis ?? "").localeCompare(b.nis ?? "", "id", { numeric: true })
          break
        case "className":
          cmp = compareClassNames(a.className, b.className)
          break
        case "status":
          cmp = statusMeta[a.status].label.localeCompare(statusMeta[b.status].label, "id")
          break
        case "note":
          cmp = a.note.localeCompare(b.note, "id")
          break
        case "total":
          cmp = total(a) - total(b)
          break
        case "riwayat":
          cmp = riwayatScore(a) - riwayatScore(b)
          break
      }
      return cmp * dir || byName(a, b)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, sort, activeStatuses])

  useEffect(() => {
    setPage(1)
  }, [query, activeStatuses, perPage, students])

  const totalItems = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * perPage
  const paged = sorted.slice(startIndex, startIndex + perPage)

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      dir: current.key === key && current.dir === "asc" ? "desc" : "asc",
    }))
  }

  function toggleStatus(status: AbsentStatus) {
    setActiveStatuses((current) => {
      const next = new Set(current)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const shownKeys = HISTORY_KEYS.filter((status) => activeStatuses.has(status))

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserX className="size-4 text-[var(--chart-5)]" />
              Siswa Tidak Hadir pada Tanggal Dipilih
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5 font-medium text-foreground/80">
              <CalendarDays className="size-3.5 text-primary" />
              {formatLongDate(date)}
            </CardDescription>
            <p className="text-sm text-muted-foreground">
              Daftar siswa dengan status sakit, izin, dispensasi, atau alfa
            </p>
          </div>
          <span className="w-fit shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold text-foreground tabular-nums">
            {statusFiltered.length} siswa
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama, NIS, NISN, atau kelas..."
              className="h-9 pl-8"
              aria-label="Cari nama siswa atau kelas"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Filter status</p>
            <div role="group" aria-label="Filter status ketidakhadiran" className="flex flex-wrap gap-1.5">
              {HISTORY_KEYS.map((status) => {
                const active = activeStatuses.has(status)
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleStatus(status)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      active
                        ? cn(statusMeta[status].badge, "border-current/25 shadow-sm")
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className={cn("flex size-4 items-center justify-center rounded-sm border", active ? "border-current/35 bg-current/10" : "border-input")}>
                      {active ? <Check className="size-3" /> : null}
                    </span>
                    {statusMeta[status].label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {totalItems === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {query
              ? "Tidak ada siswa yang cocok dengan pencarian."
              : activeStatuses.size === 0
                ? "Aktifkan setidaknya satu filter status untuk menampilkan siswa."
                : "Semua siswa hadir. Tidak ada catatan ketidakhadiran."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[1000px] table-fixed">
                <colgroup>
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "18%" }} />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <SortHead label="Nama Siswa" col="name" sort={sort} onSort={toggleSort} />
                    <SortHead label="NIS" col="nis" sort={sort} onSort={toggleSort} />
                    <SortHead label="Kelas" col="className" sort={sort} onSort={toggleSort} />
                    <SortHead label="Status" col="status" sort={sort} onSort={toggleSort} />
                    <SortHead label="Keterangan" col="note" sort={sort} onSort={toggleSort} />
                    <SortHead
                      label="Total Ketidakhadiran"
                      subLabel="berdasarkan filter aktif"
                      col="total"
                      sort={sort}
                      onSort={toggleSort}
                      align="center"
                    />
                    <SortHead label="Riwayat" col="riwayat" sort={sort} onSort={toggleSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((s) => {
                    const meta = statusMeta[s.status]
                    const badges = shownKeys
                      .map((k) => ({ key: k, value: s.history[k] }))
                      .filter((b) => b.value > 0)
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar className="size-8 shrink-0">
                              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                                {initials(s.name)}
                              </AvatarFallback>
                            </Avatar>
                            <ProfileNameLink type="student" id={s.id} name={s.name} className="truncate font-medium text-foreground" />
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {s.nis ?? "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {s.className}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                              meta.badge,
                            )}
                          >
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-pretty text-muted-foreground">
                          {s.note}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex items-baseline justify-center gap-1 whitespace-nowrap">
                            <span className="text-xl font-bold leading-none tracking-tight text-foreground tabular-nums">
                              {total(s)}
                            </span>
                            <span className="text-xs font-medium text-muted-foreground">hari</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          {badges.length === 0 ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {badges.map((b) => (
                                <span
                                  key={b.key}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                    statusMeta[b.key].badge,
                                  )}
                                >
                                  {statusMeta[b.key].label}
                                  <span className="tabular-nums">{b.value}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>
                  Menampilkan{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {startIndex + 1}
                  </span>
                  {"–"}
                  <span className="font-medium text-foreground tabular-nums">
                    {startIndex + paged.length}
                  </span>{" "}
                  dari <span className="font-medium text-foreground tabular-nums">{totalItems}</span>{" "}
                  siswa
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Per halaman</span>
                  <div className="flex items-center gap-1 rounded-lg border border-border/60 p-0.5">
                    {PER_PAGE_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setPerPage(opt)}
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
                          perPage === opt
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                        aria-pressed={perPage === opt}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 bg-card"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Halaman sebelumnya"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="min-w-16 text-center text-xs text-muted-foreground tabular-nums sm:hidden">
                    {currentPage} / {totalPages}
                  </span>
                  <div className="hidden items-center gap-1 sm:flex">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPage(p)}
                        className={cn(
                          "flex size-8 items-center justify-center rounded-md text-sm font-medium tabular-nums transition-colors",
                          p === currentPage
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                        aria-current={p === currentPage ? "page" : undefined}
                        aria-label={`Halaman ${p}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 bg-card"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Halaman berikutnya"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SortHead({
  label,
  subLabel,
  col,
  sort,
  onSort,
  align = "left",
}: {
  label: string
  subLabel?: string
  col: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  align?: "left" | "center"
}) {
  const active = sort?.key === col
  const ariaSort = active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"
  return (
    <TableHead
      aria-sort={ariaSort}
      className={cn("h-auto py-3 align-middle", align === "center" && "text-center")}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-label={`${label}, ${active ? `diurutkan ${sort?.dir === "asc" ? "menaik" : "menurun"}` : "belum diurutkan"}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          align === "center" && "justify-center",
          active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground",
        )}
      >
        <span className={cn("flex flex-col", align === "center" ? "items-center" : "items-start")}>
          <span className="whitespace-nowrap leading-tight">{label}</span>
          {subLabel ? (
            <span className="whitespace-nowrap text-[11px] font-normal leading-tight text-muted-foreground">
              {subLabel}
            </span>
          ) : null}
        </span>
        {active ? (
          sort?.dir === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0 text-primary" />
          ) : (
            <ArrowDown className="size-3.5 shrink-0 text-primary" />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        )}
      </button>
    </TableHead>
  )
}

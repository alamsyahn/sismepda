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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { statusMeta, type AbsentStudent } from "@/lib/dashboard-data"
import { compareClassNames } from "@/lib/class-order"

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
type SortState = { key: SortKey; dir: SortDir } | null

const PER_PAGE_OPTIONS = [10, 25, 50] as const

// Kategori riwayat (dispensasi opsional mengikuti checkbox)
const HISTORY_KEYS = ["sakit", "izin", "alfa", "dispensasi"] as const

export function AbsentStudentsTable({ students }: { students: AbsentStudent[] }) {
  const [includeDispensasi, setIncludeDispensasi] = useState(true)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortState>(null)
  const [perPage, setPerPage] = useState<number>(10)
  const [page, setPage] = useState(1)

  const total = (s: AbsentStudent) =>
    s.history.sakit + s.history.izin + s.history.alfa + (includeDispensasi ? s.history.dispensasi : 0)

  const riwayatScore = (s: AbsentStudent) =>
    HISTORY_KEYS.filter((k) => (k === "dispensasi" && !includeDispensasi ? false : s.history[k] > 0)).length

  // 1. Filter berdasarkan checkbox dispensasi
  const checkboxFiltered = useMemo(
    () => (includeDispensasi ? students : students.filter((s) => s.status !== "dispensasi")),
    [students, includeDispensasi],
  )

  // 2. Filter pencarian (nama / kelas)
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return checkboxFiltered
    return checkboxFiltered.filter(
      (s) => s.name.toLowerCase().includes(q) || s.nis?.includes(q) || s.nisn?.includes(q) || s.className.toLowerCase().includes(q),
    )
  }, [checkboxFiltered, query])

  // 3. Sorting
  const sorted = useMemo(() => {
    const rows = [...searched]
    const byName = (a: AbsentStudent, b: AbsentStudent) => a.name.localeCompare(b.name, "id")

    if (!sort) {
      // Default: total ketidakhadiran terbesar -> terkecil, lalu alfabet nama
      return rows.sort((a, b) => total(b) - total(a) || byName(a, b))
    }

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
  }, [searched, sort, includeDispensasi])

  // Reset ke halaman 1 ketika filter berubah
  useEffect(() => {
    setPage(1)
  }, [query, includeDispensasi, perPage, students])

  const totalItems = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * perPage
  const paged = sorted.slice(startIndex, startIndex + perPage)

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" }
      if (prev.dir === "asc") return { key, dir: "desc" }
      return null
    })
  }

  const shownKeys = HISTORY_KEYS.filter((k) => k !== "dispensasi" || includeDispensasi)

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserX className="size-4 text-[var(--chart-5)]" />
              Siswa Tidak Hadir pada Tanggal Dipilih
            </CardTitle>
            <CardDescription>
              Daftar siswa dengan status sakit, izin, dispensasi, atau alfa
            </CardDescription>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-sm font-semibold text-foreground tabular-nums">
            {checkboxFiltered.length}
          </span>
        </div>

        {/* Kontrol: pencarian + checkbox dispensasi */}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama, NIS, NISN, atau kelas..."
              className="h-9 pl-8"
              aria-label="Cari nama siswa atau kelas"
            />
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={includeDispensasi}
              onCheckedChange={(checked) => setIncludeDispensasi(checked === true)}
            />
            Hitung siswa dispensasi
          </label>
        </div>
      </CardHeader>

      <CardContent>
        {totalItems === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {query
              ? "Tidak ada siswa yang cocok dengan pencarian."
              : "Semua siswa hadir. Tidak ada catatan ketidakhadiran."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[1000px] table-fixed">
                <colgroup>
                  <col style={{ width: "19%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "21%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "19%" }} />
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
                      subLabel={includeDispensasi ? "(termasuk dispensasi)" : undefined}
                      col="total"
                      sort={sort}
                      onSort={toggleSort}
                      align="right"
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
                            <span className="truncate font-medium text-foreground">
                              {s.name}
                            </span>
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
                        <TableCell className="text-right">
                          <span className="font-semibold text-foreground tabular-nums">
                            {total(s)}
                          </span>
                          <span className="text-xs text-muted-foreground"> hari</span>
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

              <div className="flex items-center gap-4">
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
                    >
                      {p}
                    </button>
                  ))}
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
  align?: "left" | "right"
}) {
  const active = sort?.key === col
  return (
    <TableHead className={cn("h-auto py-3 align-middle", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        <span className={cn("flex flex-col", align === "right" ? "items-end" : "items-start")}>
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

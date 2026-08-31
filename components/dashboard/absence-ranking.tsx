"use client"

import { useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search,
  SearchX,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { compareClassNames } from "@/lib/class-order"
import { statusMeta } from "@/lib/dashboard-data"
import { ProfileNameLink } from "@/components/profile/profile-name-link"

export type AbsenceRankingRow = {
  id: string
  nis: string | null
  nisn: string | null
  name: string
  className: string
  sakit: number
  izin: number
  alfa: number
  dispensasi: number
}

type StatusKey = "sakit" | "izin" | "alfa" | "dispensasi"
type SortKey = "rank" | "name" | "nis" | "className" | StatusKey | "total"
type SortDir = "asc" | "desc" | null

const statusFilters: { key: StatusKey; label: string; badge: string }[] = [
  { key: "sakit", label: "Sakit", badge: statusMeta.sakit.badge },
  { key: "izin", label: "Izin", badge: statusMeta.izin.badge },
  { key: "alfa", label: "Alfa", badge: statusMeta.alfa.badge },
  { key: "dispensasi", label: "Dispensasi", badge: statusMeta.dispensasi.badge },
]

const perPageOptions = [10, 25, 50, 100]

const rankBadge: Record<number, string> = {
  1: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  2: "bg-slate-100 text-slate-600 ring-1 ring-slate-300",
  3: "bg-orange-100 text-orange-700 ring-1 ring-orange-300",
}

export function AbsenceRanking({ students }: { students: AbsenceRankingRow[] }) {
  const [active, setActive] = useState<Record<StatusKey, boolean>>({
    sakit: true,
    izin: true,
    alfa: true,
    dispensasi: true,
  })
  const [query, setQuery] = useState("")
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>("total")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const activeKeys = useMemo(
    () => statusFilters.map((s) => s.key).filter((k) => active[k]),
    [active],
  )
  const noneActive = activeKeys.length === 0

  // Filter by search + compute totals
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return students
      .filter(
        (s) =>
          q === "" ||
          s.name.toLowerCase().includes(q) ||
          s.nis?.includes(q) ||
          s.nisn?.includes(q) ||
          s.className.toLowerCase().includes(q),
      )
      .map((s) => ({ student: s, total: activeKeys.reduce((sum, k) => sum + s[k], 0) }))
  }, [students, query, activeKeys])

  const sorted = useMemo(() => {
    const rows = [...filtered]
    const dir = sortDir === "asc" ? 1 : -1

    // baseline ranking: total desc, tie-break name asc
    const baseline = (a: typeof rows[number], b: typeof rows[number]) =>
      b.total - a.total || a.student.name.localeCompare(b.student.name, "id")

    if (sortDir === null) {
      rows.sort(baseline)
      return rows
    }

    rows.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "name":
          cmp = a.student.name.localeCompare(b.student.name, "id")
          break
        case "nis":
          cmp = (a.student.nis ?? "").localeCompare(b.student.nis ?? "", "id", { numeric: true })
          break
        case "className":
          cmp = compareClassNames(a.student.className, b.student.className)
          break
        case "total":
        case "rank":
          cmp = a.total - b.total
          break
        default:
          cmp = a.student[sortKey] - b.student[sortKey]
      }
      if (cmp === 0) return a.student.name.localeCompare(b.student.name, "id")
      return cmp * dir
    })
    return rows
  }, [filtered, sortKey, sortDir])

  const totalRows = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalRows / perPage))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * perPage
  const pageRows = sorted.slice(start, start + perPage)

  function handleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir("asc")
      return
    }
    // cycle asc -> desc -> default
    setSortDir((prev) => (prev === "asc" ? "desc" : prev === "desc" ? null : "asc"))
  }

  function toggleStatus(key: StatusKey) {
    setActive((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      // enforce at least one active
      if (!Object.values(next).some(Boolean)) return prev
      return next
    })
    setPage(1)
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column || sortDir === null)
      return <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
    return sortDir === "asc" ? (
      <ArrowUp className="size-3.5 text-primary" />
    ) : (
      <ArrowDown className="size-3.5 text-primary" />
    )
  }

  function SortHeader({
    column,
    label,
    className,
  }: {
    column: SortKey
    label: string
    className?: string
  }) {
    const activeCol = sortKey === column && sortDir !== null
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => handleSort(column)}
          className={cn(
            "-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition-colors hover:bg-muted",
            activeCol ? "text-primary" : "text-foreground",
          )}
        >
          {label}
          <SortIcon column={column} />
        </button>
      </TableHead>
    )
  }

  const showing = totalRows === 0 ? 0 : start + 1
  const showingEnd = Math.min(start + perPage, totalRows)

  const pageNumbers = getPageNumbers(currentPage, totalPages)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ranking Ketidakhadiran</CardTitle>
        <CardDescription>
          Peringkat siswa berdasarkan jumlah ketidakhadiran akumulatif sejak awal periode.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {statusFilters.map((s) => (
              <label
                key={s.key}
                htmlFor={`flt-${s.key}`}
                className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  id={`flt-${s.key}`}
                  checked={active[s.key]}
                  onCheckedChange={() => toggleStatus(s.key)}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="Cari nama, NIS, NISN, atau kelas..."
                className="w-full pl-9 sm:w-64"
                aria-label="Cari nama siswa atau kelas"
              />
            </div>
            <Select
              value={String(perPage)}
              onValueChange={(v) => {
                setPerPage(Number(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-full bg-card sm:w-44">
                <SelectValue>{(v: string) => `Tampilkan ${v}`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {perPageOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {`${n} per halaman`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <SortHeader column="rank" label="Peringkat" className="w-20" />
                <SortHeader column="name" label="Nama Siswa" className="min-w-44" />
                <SortHeader column="nis" label="NIS" />
                <SortHeader column="className" label="Kelas" />
                {activeKeys.includes("sakit") && (
                  <SortHeader column="sakit" label="Sakit" className="text-center" />
                )}
                {activeKeys.includes("izin") && (
                  <SortHeader column="izin" label="Izin" className="text-center" />
                )}
                {activeKeys.includes("alfa") && (
                  <SortHeader column="alfa" label="Alfa" className="text-center" />
                )}
                {activeKeys.includes("dispensasi") && (
                  <SortHeader column="dispensasi" label="Dispensasi" className="text-center" />
                )}
                <SortHeader column="total" label="Total Ketidakhadiran" className="text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {noneActive ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    Pilih minimal satu jenis ketidakhadiran.
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <SearchX className="size-6" />
                      </span>
                      <p className="font-semibold text-foreground">Data siswa tidak ditemukan</p>
                      <p className="text-sm text-muted-foreground">
                        Coba ubah kata pencarian atau filter ketidakhadiran.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, idx) => {
                  const rank = start + idx + 1
                  return (
                    <TableRow key={row.student.id} className="odd:bg-muted/20">
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-sm font-semibold",
                            rankBadge[rank] ?? "text-muted-foreground",
                          )}
                        >
                          {rank}
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">
                        <ProfileNameLink type="student" id={row.student.id} name={row.student.name} />
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {row.student.nis ?? "-"}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                          {row.student.className}
                        </span>
                      </TableCell>
                      {activeKeys.includes("sakit") && (
                        <CountCell value={row.student.sakit} badge={statusFilters[0].badge} />
                      )}
                      {activeKeys.includes("izin") && (
                        <CountCell value={row.student.izin} badge={statusFilters[1].badge} />
                      )}
                      {activeKeys.includes("alfa") && (
                        <CountCell value={row.student.alfa} badge={statusFilters[2].badge} />
                      )}
                      {activeKeys.includes("dispensasi") && (
                        <CountCell value={row.student.dispensasi} badge={statusFilters[3].badge} />
                      )}
                      <TableCell className="text-center">
                        <span className="text-base font-bold text-foreground">{row.total}</span>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {!noneActive && totalRows > 0 && (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {`Menampilkan ${showing}\u2013${showingEnd} dari ${totalRows.toLocaleString("id-ID")} siswa`}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Sebelumnya
              </Button>
              {pageNumbers.map((p, i) =>
                p === "..." ? (
                  <span key={`e${i}`} className="px-2 text-sm text-muted-foreground">
                    &hellip;
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === currentPage ? "default" : "outline"}
                    size="sm"
                    className="min-w-9"
                    onClick={() => setPage(p as number)}
                  >
                    {p}
                  </Button>
                ),
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CountCell({ value, badge }: { value: number; badge: string }) {
  return (
    <TableCell className="text-center">
      <span
        className={cn(
          "inline-flex min-w-7 items-center justify-center rounded-md px-2 py-0.5 text-sm font-medium",
          value > 0 ? badge : "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </TableCell>
  )
}

function getPageNumbers(current: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages: (number | "...")[] = [1]
  const startPage = Math.max(2, current - 1)
  const endPage = Math.min(totalPages - 1, current + 1)
  if (startPage > 2) pages.push("...")
  for (let i = startPage; i <= endPage; i++) pages.push(i)
  if (endPage < totalPages - 1) pages.push("...")
  pages.push(totalPages)
  return pages
}

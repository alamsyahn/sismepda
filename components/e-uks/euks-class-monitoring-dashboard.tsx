"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import { EuksClassNutritionBar } from "@/components/e-uks/euks-class-nutrition-bar"
import { EuksClassSickTrend, EuksClassVisitTrend } from "@/components/e-uks/euks-class-trends"
import { nutritionCategoryLabels, nutritionCategoryTone } from "@/lib/bmi-for-age"
import {
  CLASS_TABLE_SORTS,
  UNKNOWN_SLICE,
  filterAndSortRows,
  formatAge,
  genderShortLabel,
  isClassTableSort,
  type ClassMonitoringSummary,
  type ClassStudentHealthRow,
  type ClassTableSort,
} from "@/lib/euks-class-monitoring"
import {
  ATTENTION_PARAM,
  CLASS_PARAM,
  DESC_PARAM,
  GENDER_PARAM,
  NUTRITION_PARAM,
  PERIOD_PARAM,
  SEARCH_PARAM,
  SORT_PARAM,
  studentDetailHref,
} from "@/lib/euks-class-navigation"
import { NUTRITION_CATEGORY_ORDER, formatShare } from "@/lib/euks-nutrition"
import { TREND_GRANULARITIES, type TrendGranularity } from "@/lib/attendance-trend"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

const periodLabels: Record<TrendGranularity, string> = {
  harian: "30 hari terakhir",
  mingguan: "12 minggu terakhir",
  bulanan: "12 bulan terakhir",
  semester: "Sejak awal semester",
}

/**
 * Frasa untuk disisipkan di tengah kalimat ("… sakit pada 12 bulan terakhir").
 * Dipisahkan dari `periodLabels` karena label dropdown "Sejak awal semester"
 * menghasilkan "pada sejak awal semester" bila dipakai langsung.
 */
const periodPhrases: Record<TrendGranularity, string> = {
  harian: "pada 30 hari terakhir",
  mingguan: "pada 12 minggu terakhir",
  bulanan: "pada 12 bulan terakhir",
  semester: "sejak awal semester",
}

const sortLabels: Record<ClassTableSort, string> = {
  nama: "Nama",
  sakit: "Sakit",
  uks: "Masuk UKS",
  imt: "IMT",
  diukur: "Terakhir diukur",
}

export type ClassOption = { id: string; name: string }

/**
 * Dashboard Pantauan Kesehatan Kelas.
 *
 * Seluruh state (kelas, periode, filter, urutan) hidup di URL, bukan di
 * `useState`: itulah yang membuat refresh dan tombol kembali dari halaman
 * siswa memulihkan tampilan yang sama. Pemilihan kelas dan periode memicu
 * navigasi server karena mengubah data yang perlu diambil; filter dan urutan
 * tabel memakai `router.replace` dengan `scroll: false` karena hanya menyaring
 * baris yang sudah ada di klien.
 *
 * Agregasinya sendiri tidak dikerjakan di sini — `summary` datang jadi dari
 * server, dan komponen ini hanya menyaring/mengurutkan lewat fungsi murni yang
 * sama.
 */
export function EuksClassMonitoringDashboard({
  classes,
  summary,
  semesterAvailable,
}: {
  classes: ClassOption[]
  summary: ClassMonitoringSummary | null
  semesterAvailable: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [attentionOpen, setAttentionOpen] = useState(false)

  const currentClassId = searchParams.get(CLASS_PARAM) ?? ""
  const currentPeriod = searchParams.get(PERIOD_PARAM) ?? "bulanan"
  const search = searchParams.get(SEARCH_PARAM) ?? ""
  const nutrition = searchParams.get(NUTRITION_PARAM) ?? ""
  const gender = searchParams.get(GENDER_PARAM) ?? ""
  const attentionOnly = searchParams.get(ATTENTION_PARAM) === "1"
  const sortValue = searchParams.get(SORT_PARAM) ?? ""
  const sort: ClassTableSort = isClassTableSort(sortValue) ? sortValue : "nama"
  const descending = searchParams.get(DESC_PARAM) === "1"

  /** Query string sekarang dengan beberapa parameter diubah/dihapus. */
  const withParams = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key)
      else params.set(key, value)
    }
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  const navigate = (changes: Record<string, string | null>) => {
    router.push(withParams(changes))
  }
  const refine = (changes: Record<string, string | null>) => {
    router.replace(withParams(changes), { scroll: false })
  }

  const rows = useMemo(
    () =>
      summary
        ? filterAndSortRows(summary.rows, {
            search,
            nutrition,
            gender,
            attentionOnly,
            sort,
            descending,
          })
        : [],
    [summary, search, nutrition, gender, attentionOnly, sort, descending],
  )

  const attentionRows = useMemo(
    () => (summary ? summary.rows.filter((row) => row.attentionReasons.length > 0) : []),
    [summary],
  )

  const periodOptions = TREND_GRANULARITIES.filter(
    (value) => value !== "semester" || semesterAvailable,
  )

  const returnTo = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Kelas</span>
            <Select
              value={currentClassId || null}
              onValueChange={(value: string | null) =>
                navigate({ [CLASS_PARAM]: value })
              }
            >
              <SelectTrigger className="bg-card w-full" aria-label="Pilih kelas">
                <SelectValue placeholder="Pilih kelas">
                  {(value: string | null) =>
                    classes.find((option) => option.id === value)?.name ?? "Pilih kelas"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {classes.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium">Periode</span>
            <Select
              value={currentPeriod}
              onValueChange={(value: string | null) =>
                value && navigate({ [PERIOD_PARAM]: value === "bulanan" ? null : value })
              }
            >
              <SelectTrigger className="bg-card w-full" aria-label="Pilih periode">
                <SelectValue>
                  {(value: string) => periodLabels[value as TrendGranularity] ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {periodLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">
              Memengaruhi hari sakit dan kunjungan UKS. Tinggi, berat, IMT, dan status gizi selalu
              memakai pengukuran terbaru siswa.
            </span>
          </label>
        </CardContent>
      </Card>

      {!summary ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              Pilih kelas untuk melihat ringkasan kesehatan siswa.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <SummaryBand
            summary={summary}
            onAttentionClick={() => setAttentionOpen(true)}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Distribusi Status Gizi</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Berdasarkan IMT menurut umur (IMT/U) dari pengukuran terbaru tiap siswa.
                </p>
              </CardHeader>
              <CardContent>
                <EuksClassNutritionBar
                  distribution={summary.distribution}
                  selected={nutrition}
                  onSelect={(key) => refine({ [NUTRITION_PARAM]: key || null })}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tren Ketidakhadiran karena Sakit</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Hari absensi berstatus sakit {periodPhrases[currentPeriod as TrendGranularity] ?? "pada periode terpilih"}.
                </p>
              </CardHeader>
              <CardContent>
                <EuksClassSickTrend buckets={summary.sickTrend} />
                <p className="text-muted-foreground mt-3 text-xs">
                  {attentionRows.filter((row) => row.longestSickStreak >= 3).length} siswa mengalami
                  sakit 3 hari berturut-turut atau lebih pada periode ini.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tren Kunjungan UKS</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Hanya kunjungan siswa kelas {summary.className}.
                </p>
              </CardHeader>
              <CardContent>
                <EuksClassVisitTrend buckets={summary.visitTrend} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Keluhan Terbanyak</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Keluhan apa adanya dari catatan kunjungan; tidak ada penyamaan istilah medis.
                </p>
              </CardHeader>
              <CardContent>
                <ComplaintRanking complaints={summary.complaints} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Kelengkapan Data Kesehatan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                Data dapat dinilai{" "}
                <span className="font-semibold tabular-nums">
                  {summary.assessableStudents} / {summary.totalStudents}
                </span>{" "}
                — {formatShare(summary.completenessShare)}
              </p>
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className="bg-chart-1 h-full rounded-full"
                  style={{ width: `${summary.completenessShare}%` }}
                />
              </div>
              {summary.completenessReasons.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Seluruh siswa kelas ini sudah dapat dinilai status gizinya.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {summary.completenessReasons.map((item) => (
                    <li key={item.reason} className="flex items-center gap-2">
                      <span className="text-muted-foreground tabular-nums">{item.count}</span>
                      <span>{item.label.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data Kesehatan Siswa — {summary.className}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TableControls
                search={search}
                nutrition={nutrition}
                gender={gender}
                attentionOnly={attentionOnly}
                sort={sort}
                descending={descending}
                onChange={refine}
              />
              <StudentTable
                rows={rows}
                classId={summary.classId}
                returnTo={returnTo}
                totalRows={summary.rows.length}
              />
            </CardContent>
          </Card>

          <AttentionDialog
            open={attentionOpen}
            onOpenChange={setAttentionOpen}
            className={summary.className}
            rows={attentionRows}
            classId={summary.classId}
            returnTo={returnTo}
          />
        </>
      )}
    </div>
  )
}

function SummaryBand({
  summary,
  onAttentionClick,
}: {
  summary: ClassMonitoringSummary
  onAttentionClick: () => void
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <BandItem label="Siswa" value={`${summary.totalStudents}`} />
        <BandItem label="Hari Sakit" value={`${summary.totalSickDays}`} />
        <BandItem label="Kunjungan UKS" value={`${summary.totalVisits}`} />
        <button
          type="button"
          onClick={onAttentionClick}
          className="hover:bg-accent/50 focus-visible:ring-ring rounded-md px-2 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Lihat ${summary.attentionCount} siswa yang perlu perhatian`}
        >
          <span className="text-muted-foreground block text-xs">Perlu Perhatian</span>
          <span className="text-2xl font-semibold tabular-nums underline decoration-dotted underline-offset-4">
            {summary.attentionCount}
          </span>
        </button>
        <BandItem
          label="Kelengkapan Data"
          value={`${summary.assessableStudents}/${summary.totalStudents}`}
          hint="dapat dinilai"
        />
      </CardContent>
    </Card>
  )
}

function BandItem({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-2 py-1">
      <span className="text-muted-foreground block text-xs">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-muted-foreground block text-xs">{hint}</span> : null}
    </div>
  )
}

function ComplaintRanking({
  complaints,
}: {
  complaints: ClassMonitoringSummary["complaints"]
}) {
  if (complaints.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Belum ada keluhan tercatat dari kelas ini pada periode terpilih.
      </p>
    )
  }
  const max = Math.max(...complaints.map((item) => item.count))
  return (
    <ul className="space-y-2">
      {complaints.map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="text-muted-foreground tabular-nums">{item.count}</span>
          </div>
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-chart-1/70 h-full rounded-full"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function TableControls({
  search,
  nutrition,
  gender,
  attentionOnly,
  sort,
  descending,
  onChange,
}: {
  search: string
  nutrition: string
  gender: string
  attentionOnly: boolean
  sort: ClassTableSort
  descending: boolean
  onChange: (changes: Record<string, string | null>) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input
        type="search"
        placeholder="Cari nama siswa"
        aria-label="Cari nama siswa"
        defaultValue={search}
        onChange={(event) => onChange({ [SEARCH_PARAM]: event.target.value || null })}
      />

      <Select
        value={nutrition || "semua"}
        onValueChange={(value: string | null) =>
          onChange({ [NUTRITION_PARAM]: !value || value === "semua" ? null : value })
        }
      >
        <SelectTrigger className="bg-card w-full" aria-label="Saring status gizi">
          <SelectValue>
            {(value: string) =>
              value === "semua"
                ? "Semua status gizi"
                : value === UNKNOWN_SLICE
                  ? "Belum dapat dinilai"
                  : (nutritionCategoryLabels[value as keyof typeof nutritionCategoryLabels] ??
                    "Semua status gizi")
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="semua">Semua status gizi</SelectItem>
          {NUTRITION_CATEGORY_ORDER.map((category) => (
            <SelectItem key={category} value={category}>
              {nutritionCategoryLabels[category]}
            </SelectItem>
          ))}
          <SelectItem value={UNKNOWN_SLICE}>Belum dapat dinilai</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={gender || "semua"}
        onValueChange={(value: string | null) =>
          onChange({ [GENDER_PARAM]: !value || value === "semua" ? null : value })
        }
      >
        <SelectTrigger className="bg-card w-full" aria-label="Saring jenis kelamin">
          <SelectValue>
            {(value: string) =>
              value === "LAKI_LAKI"
                ? "Laki-laki"
                : value === "PEREMPUAN"
                  ? "Perempuan"
                  : "Semua jenis kelamin"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="semua">Semua jenis kelamin</SelectItem>
          <SelectItem value="LAKI_LAKI">Laki-laki</SelectItem>
          <SelectItem value="PEREMPUAN">Perempuan</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-3">
        <Select
          value={sort}
          onValueChange={(value: string | null) =>
            value && onChange({ [SORT_PARAM]: value === "nama" ? null : value })
          }
        >
          <SelectTrigger className="bg-card w-full" aria-label="Urutkan menurut">
            <SelectValue>{(value: string) => sortLabels[value as ClassTableSort] ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CLASS_TABLE_SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {sortLabels[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={descending}
          onClick={() => onChange({ [DESC_PARAM]: descending ? null : "1" })}
        >
          {descending ? "Turun" : "Naik"}
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
        <input
          type="checkbox"
          className="accent-primary size-4"
          checked={attentionOnly}
          onChange={(event) => onChange({ [ATTENTION_PARAM]: event.target.checked ? "1" : null })}
        />
        Tampilkan hanya siswa yang perlu perhatian
      </label>
    </div>
  )
}

function StudentTable({
  rows,
  classId,
  returnTo,
  totalRows,
}: {
  rows: ClassStudentHealthRow[]
  classId: string
  returnTo: string
  totalRows: number
}) {
  if (totalRows === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Kelas ini belum memiliki siswa aktif.
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Tidak ada siswa yang cocok dengan filter saat ini.
      </p>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">No</TableHead>
            <TableHead>Nama Lengkap</TableHead>
            <TableHead className="w-12">L/P</TableHead>
            <TableHead className="w-16">Umur</TableHead>
            <TableHead className="w-16 text-right">Sakit</TableHead>
            <TableHead className="w-16 text-right">Masuk UKS</TableHead>
            <TableHead className="w-20 text-right">Tinggi</TableHead>
            <TableHead className="w-20 text-right">Berat</TableHead>
            <TableHead className="w-16 text-right">IMT</TableHead>
            <TableHead>Status Gizi</TableHead>
            <TableHead>Terakhir Diukur</TableHead>
            <TableHead className="w-24">Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.studentId}>
              <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
              <TableCell className="font-medium whitespace-nowrap">{row.name}</TableCell>
              <TableCell>
                {row.gender === null ? (
                  <span title="Jenis kelamin belum tersedia" className="text-muted-foreground">
                    –
                  </span>
                ) : (
                  genderShortLabel(row.gender)
                )}
              </TableCell>
              <TableCell className="tabular-nums">{formatAge(row.ageYears)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.sickDays}</TableCell>
              <TableCell className="text-right tabular-nums">{row.visits}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.heightCm === null ? unknownCell() : `${row.heightCm.toLocaleString("id-ID")} cm`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.weightKg === null ? unknownCell() : `${row.weightKg.toLocaleString("id-ID")} kg`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.bmi === null
                  ? unknownCell()
                  : row.bmi.toLocaleString("id-ID", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
              </TableCell>
              <TableCell>
                <NutritionBadge row={row} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {row.measuredAt ? formatDate(row.measuredAt) : unknownCell("Belum pernah diukur")}
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      href={studentDetailHref({
                        studentId: row.studentId,
                        classId,
                        returnTo,
                      })}
                    />
                  }
                >
                  Lihat Detail
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Status gizi sebagai label teks, bukan hanya warna. */
function NutritionBadge({ row }: { row: ClassStudentHealthRow }) {
  if (row.category === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Belum dapat dinilai
      </Badge>
    )
  }
  const tone = nutritionCategoryTone[row.category]
  return (
    <Badge variant={tone === "ok" ? "secondary" : "destructive"}>
      {nutritionCategoryLabels[row.category]}
    </Badge>
  )
}

/** Sel tanpa data: bukan angka nol, melainkan penanda "belum diketahui". */
function unknownCell(title = "Data belum tersedia") {
  return (
    <span className="text-muted-foreground" title={title}>
      –
    </span>
  )
}

function AttentionDialog({
  open,
  onOpenChange,
  className,
  rows,
  classId,
  returnTo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  className: string
  rows: ClassStudentHealthRow[]
  classId: string
  returnTo: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Perlu Perhatian — {className}</DialogTitle>
          <DialogDescription>
            Setiap siswa muncul beserta seluruh alasannya. Tidak ada skor risiko; alasan diambil
            langsung dari status gizi IMT/U dan catatan absensi sakit.
          </DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Tidak ada siswa yang perlu perhatian pada periode ini.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <li key={row.studentId} className="flex items-start justify-between gap-3 py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{row.name}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {row.attentionReasons.map((reason, index) => (
                      <li key={`${reason.kind}-${index}`}>
                        <Badge variant={reason.kind === "incomplete" ? "outline" : "destructive"}>
                          {reason.label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      href={studentDetailHref({ studentId: row.studentId, classId, returnTo })}
                    />
                  }
                >
                  Detail
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function formatDate(value: string): string {
  const parsed = parseSchoolDate(value)
  return parsed
    ? formatSchoolDate(parsed, { day: "numeric", month: "short", year: "numeric" })
    : value
}

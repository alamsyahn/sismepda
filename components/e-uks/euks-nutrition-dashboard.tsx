"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChartTooltip, ChartTooltipFrame, isMousePointer } from "@/components/e-uks/chart-tooltip"
import { EuksNutritionHeatmap } from "@/components/e-uks/euks-nutrition-heatmap"
import { useEuksReportScopeOptional } from "@/components/e-uks/euks-report-print"
import { nutritionCategoryLabels } from "@/lib/bmi-for-age"
import {
  ALL_GRADES,
  NORMAL_NUTRITION_CATEGORY,
  filterByGrade,
  formatShare,
  gradesOf,
  nutritionCategoryColor,
  nutritionInsights,
  summarizeNutrition,
  type ClassNutritionBucket,
  type NutritionSummary,
} from "@/lib/euks-nutrition"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

/**
 * Ringkasan status gizi sekolah pada Halaman Utama E-UKS.
 *
 * Komponen klien hanya karena filter tingkat: seluruh agregasi tetap memakai
 * fungsi murni yang sama dengan server, dan yang diterima dari server adalah
 * hitungan per kelas — bukan baris per siswa. Mengubah filter tidak memuat
 * ulang halaman dan tidak memicu query baru.
 */
export function EuksNutritionDashboard({ buckets }: { buckets: ClassNutritionBucket[] }) {
  const [localGrade, setLocalGrade] = useState<string>(ALL_GRADES)
  // Ketika halaman menyediakan laporan cetak, filter tingkat diangkat ke
  // provider itu supaya laporan tidak mungkin memakai cakupan yang berbeda
  // dari yang sedang dilihat. Tanpa provider, komponen ini tetap berdiri
  // sendiri dengan keadaan lokalnya.
  const shared = useEuksReportScopeOptional()
  const grade = shared?.grade ?? localGrade
  const setGrade = shared?.setGrade ?? setLocalGrade
  const grades = useMemo(() => gradesOf(buckets), [buckets])
  const summary = useMemo(
    () => summarizeNutrition(filterByGrade(buckets, grade)),
    [buckets, grade],
  )
  const insights = useMemo(() => nutritionInsights(summary), [summary])

  const gradeOptions = [
    { value: ALL_GRADES, label: "Semua siswa" },
    ...grades.map((value) => ({ value, label: `Tingkat ${value}` })),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {summary.latestMeasuredAt
            ? `Terakhir diperbarui: ${formatDate(summary.latestMeasuredAt)}`
            : "Belum ada tanggal pengukuran yang dapat ditampilkan."}
        </p>
        {grades.length > 1 ? (
          <Select value={grade} onValueChange={(value: string | null) => value && setGrade(value)}>
            <SelectTrigger className="bg-card w-full sm:w-48" aria-label="Saring menurut tingkat">
              <SelectValue>
                {(value: string) =>
                  gradeOptions.find((option) => option.value === value)?.label ?? "Semua siswa"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {gradeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Siswa Terukur"
          value={`${summary.measuredStudents} siswa`}
          hint={`${formatShare(summary.coverageShare)} dari ${summary.totalStudents} siswa`}
        />
        <StatCard
          // Label kategori kanonik sudah berbunyi sebagai status ("Gizi baik"),
          // jadi tidak perlu diberi awalan lagi supaya tidak menjadi
          // "Status Gizi Gizi baik".
          label={nutritionCategoryLabels[NORMAL_NUTRITION_CATEGORY]}
          value={summary.measuredStudents > 0 ? formatShare(summary.normalShare) : "-"}
          hint={`${summary.normalCount} siswa`}
        />
        <StatCard
          label="Perlu Perhatian"
          value={summary.measuredStudents > 0 ? formatShare(summary.attentionShare) : "-"}
          hint={`${summary.attentionCount} siswa`}
          // Judul kategori dieja lengkap supaya angka ini tidak perlu ditebak
          // maknanya; daftarnya diturunkan dari peta kategori, bukan diketik ulang.
          title={`Mencakup kategori: ${summary.attentionCategories
            .map((category) => nutritionCategoryLabels[category])
            .join(", ")}.`}
        />
        <StatCard
          label="Belum Terukur"
          value={`${summary.unmeasured.total} siswa`}
          hint={
            summary.unmeasured.incomplete > 0
              ? `${summary.unmeasured.noMeasurement} belum pernah diukur · ${summary.unmeasured.incomplete} data belum lengkap`
              : "Belum memiliki data pengukuran yang dapat dianalisis"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Sebaran Status Gizi Siswa</CardTitle>
          </CardHeader>
          <CardContent>
            <NutritionDonut summary={summary} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cakupan Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">
                {summary.measuredStudents}
              </span>{" "}
              <span className="text-muted-foreground">
                dari {summary.totalStudents} siswa memiliki data yang dapat dianalisis.
              </span>
            </p>

            {summary.unmeasured.reasons.length > 0 ? (
              <ul className="space-y-1">
                {summary.unmeasured.reasons.map((reason) => (
                  <li key={reason.reason} className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">{reason.label}</span>
                    <span className="tabular-nums">{reason.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {insights.length > 0 ? (
              <div className="space-y-2 border-t pt-4">
                <p className="font-medium">Ringkasan</p>
                <ul className="text-muted-foreground space-y-1.5">
                  {insights.map((insight) => (
                    <li key={insight} className="text-pretty">
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/e-uks/pantauan-kesehatan" />}
            >
              Lihat Pantauan Kesehatan Siswa
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status Gizi per Kelas</CardTitle>
        </CardHeader>
        <CardContent>
          <EuksNutritionHeatmap summary={summary} emptyMessage={EMPTY_MESSAGE} />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Angka di atas memakai pengukuran kesehatan terbaru masing-masing siswa, bukan seluruh
        riwayat pengukuran, sehingga siswa yang lebih sering diperiksa tidak berbobot lebih besar.
        Kategori mengikuti IMT menurut umur (WHO 5-19 tahun dengan ambang Permenkes 2/2020) yang
        juga dipakai Pantauan Kesehatan Siswa. Ini penyajian data, bukan diagnosis.
      </p>
    </div>
  )
}

function formatDate(value: string): string {
  const parsed = parseSchoolDate(value)
  return parsed ? formatSchoolDate(parsed, { day: "numeric", month: "long", year: "numeric" }) : value
}

function StatCard({
  label,
  value,
  hint,
  title,
}: {
  label: string
  value: string
  hint?: string
  title?: string
}) {
  return (
    <Card title={title}>
      <CardContent className="space-y-1">
        <p className="text-muted-foreground text-sm font-medium">
          {label}
          {title ? <span aria-hidden className="ml-1 cursor-help">ⓘ</span> : null}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-muted-foreground text-xs text-pretty">{hint}</p> : null}
        {title ? <span className="sr-only">{title}</span> : null}
      </CardContent>
    </Card>
  )
}

const EMPTY_MESSAGE = "Belum ada data pengukuran kesehatan yang dapat ditampilkan."

/**
 * Donat sebaran kategori, digambar sebagai SVG mentah seperti chart lain di
 * SISMEPDA — tidak ada pustaka chart di proyek ini dan satu donat tidak
 * sebanding dengan menambah dependensi.
 *
 * Kategori bernilai 0 tetap muncul di legenda (supaya pembaca tahu kategori itu
 * ada dan kosong) tetapi tidak menggambar busur, sehingga tidak meninggalkan
 * garis tipis palsu.
 */
function NutritionDonut({ summary }: { summary: NutritionSummary }) {
  // Kategori aktif dibagi antara busur dan legenda, jadi menyorot salah satu
  // selalu ikut menegaskan pasangannya.
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const total = summary.measuredStudents
  if (total === 0) {
    return <p className="text-muted-foreground py-10 text-center text-sm">{EMPTY_MESSAGE}</p>
  }

  const size = 220
  const radius = 88
  const stroke = 30
  const center = size / 2
  const circumference = 2 * Math.PI * radius

  const segments = summary.categories.filter((item) => item.count > 0)
  // Rotasi tiap busur = kumulatif kategori sebelumnya. Dihitung dengan reduce
  // agar tidak ada variabel yang ditulis ulang selama render.
  const arcs = segments.map((item, index) => {
    const before = segments.slice(0, index).reduce((sum, prev) => sum + prev.count, 0)
    // Sisakan celah tipis antar-segmen, kecuali bila hanya satu kategori
    // terisi — celah pada lingkaran penuh akan terlihat seperti cacat.
    const dash = Math.max(0, circumference * (item.count / total) - (segments.length > 1 ? 2 : 0))
    // Sudut tengah busur menentukan tempat tooltip muncul, sehingga kartu
    // selalu menempel pada irisan yang sedang aktif — bukan pada titik tetap.
    const midAngle = ((before + item.count / 2) / total) * 2 * Math.PI - Math.PI / 2
    return {
      ...item,
      dash,
      gap: circumference - dash,
      rotation: (before / total) * 360,
      midX: center + Math.cos(midAngle) * radius,
      midY: center + Math.sin(midAngle) * radius,
    }
  })

  const active = arcs.find((arc) => arc.category === activeCategory) ?? null
  const clear = (category: string) =>
    setActiveCategory((current) => (current === category ? null : current))

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <ChartTooltipFrame className="w-44 shrink-0 sm:w-56">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Sebaran status gizi dari ${total} siswa terukur`}
        >
          <g transform={`rotate(-90 ${center} ${center})`}>
            {arcs.map((arc) => {
              const isActive = arc.category === activeCategory
              return (
                <circle
                  key={arc.category}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={nutritionCategoryColor[arc.category]}
                  // Irisan aktif sedikit lebih tebal dan pekat; irisan lain
                  // diredam supaya penegasan terbaca tanpa mengubah bentuk.
                  strokeWidth={isActive ? stroke + 6 : stroke}
                  opacity={activeCategory === null || isActive ? 1 : 0.45}
                  strokeDasharray={`${arc.dash} ${arc.gap}`}
                  transform={`rotate(${arc.rotation} ${center} ${center})`}
                  tabIndex={0}
                  className="focus-visible:outline-ring cursor-pointer transition-[stroke-width,opacity] duration-150 focus:outline-none focus-visible:outline-2"
                  onPointerEnter={() => setActiveCategory(arc.category)}
                  onPointerDown={() => setActiveCategory(arc.category)}
                  onPointerLeave={(event) => {
                    if (isMousePointer(event)) clear(arc.category)
                  }}
                  onFocus={() => setActiveCategory(arc.category)}
                  onBlur={() => clear(arc.category)}
                >
                  <title>{`${arc.label}: ${arc.count} siswa (${formatShare(arc.share)})`}</title>
                </circle>
              )
            })}
          </g>
          <text
            x={center}
            y={center - 4}
            textAnchor="middle"
            className="fill-foreground"
            fontSize="30"
            fontWeight="600"
          >
            {total}
          </text>
          <text
            x={center}
            y={center + 20}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize="13"
          >
            Siswa terukur
          </text>
        </svg>

        {active ? (
          <ChartTooltip
            xRatio={active.midX / size}
            yRatio={active.midY / size}
            title={active.label}
            value={`${active.count} siswa`}
            rows={[`${formatShare(active.share)} dari ${total} siswa terukur`]}
          />
        ) : null}
      </ChartTooltipFrame>

      <ul className="w-full space-y-1">
        {summary.categories.map((item) => {
          const isActive = item.category === activeCategory
          const isEmpty = item.count === 0
          return (
            <li key={item.category}>
              {/* Legenda memakai elemen yang sama-sama dapat difokus supaya
                  sorotan busur tidak hanya tercapai lewat hover pada busur
                  tipis. Kategori kosong tidak dapat disorot: tidak ada busur
                  yang bisa ditegaskan. */}
              <button
                type="button"
                disabled={isEmpty}
                aria-pressed={isActive}
                onPointerEnter={() => !isEmpty && setActiveCategory(item.category)}
                onPointerDown={() => !isEmpty && setActiveCategory(item.category)}
                onPointerLeave={(event) => {
                  if (isMousePointer(event)) clear(item.category)
                }}
                onFocus={() => !isEmpty && setActiveCategory(item.category)}
                onBlur={() => clear(item.category)}
                onClick={() =>
                  setActiveCategory((current) => (current === item.category ? null : item.category))
                }
                className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default ${
                  isActive ? "bg-accent text-accent-foreground" : "enabled:hover:bg-accent/50"
                }`}
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{
                    background: nutritionCategoryColor[item.category],
                    opacity: isEmpty ? 0.4 : 1,
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {item.count} siswa
                </span>
                <span className="w-16 shrink-0 text-right font-medium tabular-nums">
                  {formatShare(item.share)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

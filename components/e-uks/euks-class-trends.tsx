"use client"

import { useState } from "react"

import { ChartTooltip, ChartTooltipFrame, isMousePointer } from "@/components/e-uks/chart-tooltip"
import { nearestIndex } from "@/lib/chart-tooltip"
import type { ClassSickTrendBucket, ClassVisitTrendBucket } from "@/lib/euks-class-monitoring"

/**
 * Tren hari sakit satu kelas sebagai batang per periode.
 *
 * Bucket kosong tetap digambar (bernilai nol) karena deretnya dibentuk
 * `bucketKeys()` — celah pada grafik berarti "tidak ada sakit", bukan "data
 * hilang", dan itu hanya benar jika periode kosong ikut ditampilkan.
 *
 * Tinggi batang memakai grid dengan baris `1fr` sebagai lajur, bukan rantai
 * `h-full` di dalam flex `items-end`. Versi flex sebelumnya membuat kolom
 * menyusut setinggi isinya, sehingga `height: N%` tidak punya acuan dan setiap
 * batang bernilai jatuh ke 0px — justru batang nol yang terlihat karena
 * tingginya piksel absolut. Lajur grid `1fr` punya tinggi pasti, jadi persen
 * di dalamnya selalu resolve.
 *
 * Warna memakai token `--gizi-kurang` (amber hangat), bukan `--chart-2` yang
 * biru: biru terang terbaca sebagai informasi netral, sedangkan ketidakhadiran
 * karena sakit adalah hal yang perlu diperhatikan. Merah sengaja dihindari agar
 * tidak terbaca sebagai galat sistem.
 */
export function EuksClassSickTrend({ buckets }: { buckets: ClassSickTrendBucket[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null)

  if (buckets.length === 0) {
    return <EmptyTrend message="Rentang periode tidak menghasilkan satu pun titik waktu." />
  }

  const hasData = buckets.some((bucket) => bucket.sickDays > 0)
  if (!hasData) {
    // Sumbu kosong dengan garis nyaris tak terlihat mudah disalahartikan
    // sebagai grafik rusak; nyatakan saja tidak ada sakit.
    return <EmptyTrend message="Belum ada ketidakhadiran karena sakit pada periode ini." />
  }

  const max = Math.max(1, ...buckets.map((bucket) => bucket.sickDays))
  const peak = buckets.reduce((highest, bucket) =>
    bucket.sickDays > highest.sickDays ? bucket : highest,
  )
  const activeIndex = buckets.findIndex((bucket) => bucket.key === activeKey)
  const active = activeIndex >= 0 ? buckets[activeIndex] : null

  return (
    <div className="space-y-2">
      <ChartTooltipFrame>
        <div
          className="grid h-44 auto-cols-fr grid-flow-col gap-1.5 overflow-x-auto"
          role="img"
          aria-label={`Tren hari sakit per periode: ${buckets
            .map((bucket) => `${bucket.tooltipLabel} ${bucket.sickDays} hari sakit, ${bucket.students} siswa`)
            .join("; ")}`}
        >
          {buckets.map((bucket) => {
            const isActive = bucket.key === activeKey
            return (
              <div key={bucket.key} className="grid min-w-9 grid-rows-[1fr_auto] gap-1">
                {/* Sasaran interaksi adalah seluruh lajur, bukan batangnya:
                    batang satu hari sakit hanya beberapa piksel tinggi dan
                    tidak nyaman disentuh. */}
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-label={`${bucket.tooltipLabel}: ${bucket.sickDays} hari sakit, ${bucket.students} siswa`}
                  className={`focus-visible:outline-ring relative rounded-t-sm transition-colors focus:outline-none focus-visible:outline-2 ${
                    isActive ? "bg-accent/40" : "hover:bg-accent/25"
                  }`}
                  onPointerEnter={() => setActiveKey(bucket.key)}
                  onPointerDown={() => setActiveKey(bucket.key)}
                  onPointerLeave={(event) => {
                    if (!isMousePointer(event)) return
                    setActiveKey((current) => (current === bucket.key ? null : current))
                  }}
                  onFocus={() => setActiveKey(bucket.key)}
                  onBlur={() => setActiveKey((current) => (current === bucket.key ? null : current))}
                >
                  {bucket.sickDays > 0 ? (
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-t-sm transition-opacity"
                      // Lantai 8% supaya satu hari sakit tetap terbaca sebagai
                      // batang, bukan garis rambut, saat maksimum periode tinggi.
                      style={{
                        height: `${Math.max(8, (bucket.sickDays / max) * 100)}%`,
                        backgroundColor: "var(--gizi-kurang)",
                        // Batang aktif dibuat penuh, yang lain sedikit diredam:
                        // penegasan tanpa mengubah tinggi, sehingga
                        // perbandingan antar-periode tetap jujur.
                        opacity: activeKey === null ? 0.9 : isActive ? 1 : 0.55,
                      }}
                    >
                      <span
                        className={`absolute -top-4 inset-x-0 text-center text-[10px] tabular-nums ${
                          isActive ? "text-foreground font-semibold" : "text-muted-foreground"
                        }`}
                      >
                        {bucket.sickDays}
                      </span>
                    </div>
                  ) : null}
                </button>
                <span
                  className={`w-full truncate border-t pt-1 text-center text-[10px] ${
                    isActive ? "text-foreground font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {bucket.label}
                </span>
              </div>
            )
          })}
        </div>

        {active ? (
          <ChartTooltip
            // Posisi mendatar diturunkan dari indeks lajur karena lajur grid
            // berbagi lebar sama rata; tooltip selalu di atas batang.
            xRatio={(activeIndex + 0.5) / buckets.length}
            yRatio={1 - Math.max(0.08, active.sickDays / max)}
            title={active.tooltipLabel}
            value={`${active.sickDays} hari sakit`}
            rows={[
              `${active.students} siswa berbeda`,
              ...(active.key === peak.key && peak.sickDays > 0 ? ["Periode tertinggi"] : []),
            ]}
          />
        ) : null}
      </ChartTooltipFrame>
      <p className="text-muted-foreground text-xs">
        Batang menunjukkan jumlah hari absensi berstatus sakit; periode tanpa batang bernilai nol.
      </p>
    </div>
  )
}

/**
 * Tren kunjungan UKS satu kelas sebagai area.
 *
 * Bentuknya mengikuti grafik kunjungan bulanan Halaman Utama: SVG mentah,
 * tanpa pustaka grafik tambahan. Berbeda dari versi sebelumnya, sumbu X TIDAK
 * lagi diregangkan dengan `preserveAspectRatio="none"`: peregangan tak seragam
 * akan membuat titik data berbentuk oval. Rasio aspek kini dijaga dan tinggi
 * ditetapkan lewat `viewBox`.
 */
export function EuksClassVisitTrend({ buckets }: { buckets: ClassVisitTrendBucket[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (buckets.length === 0) {
    return <EmptyTrend message="Rentang periode tidak menghasilkan satu pun titik waktu." />
  }

  const max = Math.max(1, ...buckets.map((bucket) => bucket.visits))
  const hasData = buckets.some((bucket) => bucket.visits > 0)

  const width = 720
  const height = 180
  const margin = { top: 14, right: 14, bottom: 10, left: 14 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const coords = buckets.map((bucket, index) => ({
    ...bucket,
    cx:
      buckets.length > 1
        ? margin.left + (plotWidth / (buckets.length - 1)) * index
        : margin.left + plotWidth / 2,
    cy: margin.top + plotHeight - (bucket.visits / max) * plotHeight,
  }))
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.cx} ${point.cy}`).join(" ")
  const baseline = margin.top + plotHeight
  const area = `${line} L${coords[coords.length - 1].cx} ${baseline} L${coords[0].cx} ${baseline} Z`

  const active = activeIndex === null ? null : (coords[activeIndex] ?? null)

  /** Nearest-x: tooltip tetap terjangkau walau titiknya kecil. */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    setActiveIndex(
      nearestIndex(
        coords.map((point) => point.cx / width),
        (event.clientX - box.left) / box.width,
      ),
    )
  }

  return (
    <div className="space-y-3">
      <ChartTooltipFrame>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-40 w-full touch-pan-y"
          role="img"
          aria-label={`Tren kunjungan UKS: ${buckets
            .map((bucket) => `${bucket.tooltipLabel} ${bucket.visits} kunjungan`)
            .join(", ")}`}
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={(event) => {
            if (isMousePointer(event)) setActiveIndex(null)
          }}
        >
          <path d={area} fill="var(--chart-1)" opacity="0.18" />
          <path
            d={line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {active ? (
            <line
              x1={active.cx}
              x2={active.cx}
              y1={margin.top}
              y2={baseline}
              stroke="var(--chart-1)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.5"
            />
          ) : null}

          {coords.map((point, index) => {
            const isActive = index === activeIndex
            return (
              <g key={point.key}>
                {/* Titik kecil yang jelas pada setiap data — permintaan utama
                    perbaikan grafik ini; sebelumnya hanya ada garis. */}
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r="14"
                  fill="transparent"
                  tabIndex={0}
                  className="focus-visible:outline-ring focus:outline-none focus-visible:outline-2"
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
                >
                  <title>{`${point.tooltipLabel}: ${point.visits} kunjungan`}</title>
                </circle>
                {isActive ? (
                  <circle cx={point.cx} cy={point.cy} r="13" fill="var(--chart-1)" opacity="0.2" />
                ) : null}
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={isActive ? 7 : 5}
                  fill={isActive ? "var(--chart-1)" : "var(--card)"}
                  stroke="var(--chart-1)"
                  strokeWidth={isActive ? 3 : 2.5}
                />
              </g>
            )
          })}
        </svg>

        {active && activeIndex !== null ? (
          <ChartTooltip
            xRatio={active.cx / width}
            yRatio={active.cy / height}
            title={active.tooltipLabel}
            value={`${active.visits} kunjungan`}
          />
        ) : null}
      </ChartTooltipFrame>

      <div className="text-muted-foreground flex gap-1.5 overflow-x-auto text-[10px]">
        {coords.map((bucket, index) => (
          <span
            key={bucket.key}
            className={`min-w-8 flex-1 truncate text-center ${
              index === activeIndex ? "text-foreground font-semibold" : ""
            }`}
            title={`${bucket.tooltipLabel}\n${bucket.visits} kunjungan`}
          >
            {bucket.label}
          </span>
        ))}
      </div>
      {!hasData ? (
        <p className="text-muted-foreground text-xs">
          Tidak ada kunjungan UKS dari kelas ini pada periode terpilih.
        </p>
      ) : null}
    </div>
  )
}

function EmptyTrend({ message }: { message: string }) {
  return <p className="text-muted-foreground text-sm">{message}</p>
}

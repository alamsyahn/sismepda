"use client"

import type { ClassSickTrendBucket, ClassVisitTrendBucket } from "@/lib/euks-class-monitoring"

/**
 * Tren hari sakit satu kelas sebagai batang per periode.
 *
 * Bucket kosong tetap digambar (bernilai nol) karena deretnya dibentuk
 * `bucketKeys()` — celah pada grafik berarti "tidak ada sakit", bukan "data
 * hilang", dan itu hanya benar jika periode kosong ikut ditampilkan.
 */
export function EuksClassSickTrend({ buckets }: { buckets: ClassSickTrendBucket[] }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.sickDays))
  const hasData = buckets.some((bucket) => bucket.sickDays > 0)

  if (buckets.length === 0) {
    return <EmptyTrend message="Rentang periode tidak menghasilkan satu pun titik waktu." />
  }

  return (
    <div className="space-y-3">
      <div
        className="flex h-40 items-end gap-1.5 overflow-x-auto pb-1"
        role="img"
        aria-label={`Tren hari sakit: ${buckets
          .map((bucket) => `${bucket.tooltipLabel} ${bucket.sickDays} hari`)
          .join(", ")}`}
      >
        {buckets.map((bucket) => (
          <div key={bucket.key} className="flex min-w-8 flex-1 flex-col items-center gap-1">
            <div className="flex h-full w-full items-end">
              <div
                className="bg-chart-2/80 w-full rounded-t-sm"
                style={{
                  // Batang nol tetap disisakan garis tipis supaya sumbu waktunya
                  // terbaca utuh, tapi jelas berbeda dari batang bernilai.
                  height: bucket.sickDays === 0 ? "2px" : `${(bucket.sickDays / max) * 100}%`,
                  opacity: bucket.sickDays === 0 ? 0.3 : 1,
                }}
                title={`${bucket.tooltipLabel}\n${bucket.sickDays} hari sakit\n${bucket.students} siswa`}
              />
            </div>
            <span className="text-muted-foreground w-full truncate text-center text-[10px]">
              {bucket.label}
            </span>
          </div>
        ))}
      </div>
      {!hasData ? (
        <p className="text-muted-foreground text-xs">
          Tidak ada ketidakhadiran karena sakit pada periode ini.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Tren kunjungan UKS satu kelas sebagai area.
 *
 * Bentuknya mengikuti grafik kunjungan bulanan Halaman Utama: SVG mentah,
 * `preserveAspectRatio="none"`, tanpa pustaka grafik tambahan.
 */
export function EuksClassVisitTrend({ buckets }: { buckets: ClassVisitTrendBucket[] }) {
  if (buckets.length === 0) {
    return <EmptyTrend message="Rentang periode tidak menghasilkan satu pun titik waktu." />
  }

  const max = Math.max(1, ...buckets.map((bucket) => bucket.visits))
  const hasData = buckets.some((bucket) => bucket.visits > 0)
  const width = 100
  const height = 40
  const step = buckets.length > 1 ? width / (buckets.length - 1) : 0
  const points = buckets.map((bucket, index) => {
    const x = buckets.length > 1 ? index * step : width / 2
    const y = height - (bucket.visits / max) * (height - 4) - 2
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const area = `0,${height} ${points.join(" ")} ${width},${height}`

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`Tren kunjungan UKS: ${buckets
          .map((bucket) => `${bucket.tooltipLabel} ${bucket.visits} kunjungan`)
          .join(", ")}`}
      >
        <polygon points={area} fill="var(--chart-1)" opacity={0.18} />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="text-muted-foreground flex gap-1.5 overflow-x-auto text-[10px]">
        {buckets.map((bucket) => (
          <span
            key={bucket.key}
            className="min-w-8 flex-1 truncate text-center"
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

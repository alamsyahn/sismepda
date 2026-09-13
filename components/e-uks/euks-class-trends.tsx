"use client"

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
 */
export function EuksClassSickTrend({ buckets }: { buckets: ClassSickTrendBucket[] }) {
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

  return (
    <div className="space-y-2">
      <div
        className="grid h-44 auto-cols-fr grid-flow-col gap-1.5 overflow-x-auto"
        role="img"
        aria-label={`Tren hari sakit per periode: ${buckets
          .map((bucket) => `${bucket.tooltipLabel} ${bucket.sickDays} hari sakit, ${bucket.students} siswa`)
          .join("; ")}`}
      >
        {buckets.map((bucket) => (
          <div key={bucket.key} className="grid min-w-9 grid-rows-[1fr_auto] gap-1">
            <div
              className="relative"
              title={`${bucket.tooltipLabel}\nHari sakit: ${bucket.sickDays}\nSiswa sakit: ${bucket.students}`}
            >
              {bucket.sickDays > 0 ? (
                <div
                  className="bg-chart-2 absolute inset-x-0 bottom-0 rounded-t-sm"
                  // Lantai 8% supaya satu hari sakit tetap terbaca sebagai
                  // batang, bukan garis rambut, saat maksimum periode tinggi.
                  style={{ height: `${Math.max(8, (bucket.sickDays / max) * 100)}%` }}
                >
                  <span className="text-muted-foreground absolute -top-4 inset-x-0 text-center text-[10px]">
                    {bucket.sickDays}
                  </span>
                </div>
              ) : null}
            </div>
            <span className="text-muted-foreground w-full truncate border-t pt-1 text-center text-[10px]">
              {bucket.label}
            </span>
          </div>
        ))}
      </div>
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

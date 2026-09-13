import type { TrendCount } from "@/lib/euks-trends"

/**
 * Peringkat keluhan bergaya Pareto: nomor urut, batang proporsional, jumlah,
 * dan porsi.
 *
 * Bukan pie/donut: keluhan bisa belasan kategori, dan membandingkan sudut
 * juring jauh lebih sulit daripada membandingkan panjang batang. Warnanya satu
 * keluarga aksen dengan tiga teratas sedikit lebih pekat — bukan warna acak
 * per kategori, yang hanya menambah beban baca tanpa menambah informasi.
 *
 * Porsi datang apa adanya dari `rankTerms()`: pembaginya seluruh entri tidak
 * kosong, dan satu kunjungan dapat menyumbang istilah pada keluhan maupun
 * tindakan. Komponen ini tidak menghitung ulang apa pun.
 */
export function EuksComplaintRanking({
  rows,
  emptyLabel,
}: {
  rows: TrendCount[]
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>
  }

  // Skala relatif terhadap baris terbanyak agar perbedaan tetap terbaca ketika
  // seluruh angka kecil.
  const max = Math.max(...rows.map((row) => row.count))

  return (
    <ol className="space-y-3">
      {rows.map((row, index) => {
        const top = index < 3 && row.key !== "__lainnya__"
        return (
          <li key={row.key} className="grid grid-cols-[1.5rem_1fr] items-baseline gap-x-3 gap-y-1">
            <span
              className={
                top
                  ? "text-euks-accent text-sm font-semibold tabular-nums"
                  : "text-muted-foreground text-sm tabular-nums"
              }
            >
              {row.key === "__lainnya__" ? "–" : `#${index + 1}`}
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {/* Dibiarkan membungkus, bukan dipotong: keluhan panjang harus
                    tetap terbaca utuh supaya artinya tidak hilang. */}
                <span className={top ? "font-semibold text-pretty" : "font-medium text-pretty"}>
                  {row.label}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="font-semibold">{row.count}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {row.share.toFixed(1).replace(".", ",")}%
                  </span>
                </span>
              </div>
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div
                  className="bg-euks-accent h-full rounded-full"
                  style={{
                    width: `${max === 0 ? 0 : (row.count / max) * 100}%`,
                    // Tiga teratas dibedakan lewat kepekatan, bukan warna lain,
                    // supaya keluarga warnanya tetap satu.
                    opacity: top ? 1 : 0.55,
                  }}
                />
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

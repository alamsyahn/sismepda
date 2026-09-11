import type { TrendCount } from "@/lib/euks-trends"

/**
 * Peringkat keluhan sebagai bar horizontal, mengikuti struktur wireframe 03.
 *
 * Digambar dengan elemen biasa, bukan SVG: barnya sederhana dan cara ini
 * membuat teks tetap dapat dipilih dan dibaca pembaca layar.
 */
export function EuksTermRanking({ rows, emptyLabel }: { rows: TrendCount[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>
  }

  // Skala relatif terhadap baris terbanyak agar perbedaan tetap terbaca ketika
  // seluruh angka kecil.
  const max = Math.max(...rows.map((row) => row.count))

  return (
    <ol className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{row.label}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {row.count} ({row.share.toFixed(1).replace(".", ",")}%)
            </span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${max === 0 ? 0 : (row.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  )
}

"use client"

import { useMemo } from "react"

import { UNKNOWN_SLICE, type NutritionDistributionSlice } from "@/lib/euks-class-monitoring"
import { formatShare } from "@/lib/euks-nutrition"

/**
 * Distribusi status gizi sebagai bar bertumpuk 100%.
 *
 * Bar hanya ringkasan visual; angka sebenarnya selalu ada di legenda sebagai
 * teks, jadi status tidak pernah disampaikan lewat warna saja. Legenda juga
 * berfungsi sebagai penyaring tabel siswa di bawahnya.
 */
export function EuksClassNutritionBar({
  distribution,
  selected,
  onSelect,
}: {
  distribution: NutritionDistributionSlice[]
  selected: string
  onSelect: (key: string) => void
}) {
  const visible = useMemo(
    () => distribution.filter((slice) => slice.count > 0),
    [distribution],
  )
  const total = distribution.reduce((sum, slice) => sum + slice.count, 0)

  if (total === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Belum ada siswa aktif di kelas ini, sehingga distribusi status gizi tidak dapat ditampilkan.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div
        className="border-border/60 flex h-6 w-full overflow-hidden rounded-full border"
        role="img"
        aria-label={`Distribusi status gizi: ${visible
          .map((slice) => `${slice.label} ${slice.count} siswa (${formatShare(slice.share)})`)
          .join(", ")}`}
      >
        {visible.map((slice) => (
          <div
            key={slice.key}
            className="h-full"
            style={{
              width: `${slice.share}%`,
              // Irisan "Belum dapat dinilai" memakai warna teredam agar tidak
              // terbaca sebagai kategori gizi keenam.
              backgroundColor: slice.color,
              opacity: slice.key === UNKNOWN_SLICE ? 0.35 : 0.85,
            }}
            title={`${slice.label} — ${slice.count} siswa (${formatShare(slice.share)})`}
          />
        ))}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {distribution.map((slice) => {
          const isSelected = selected === slice.key
          return (
            <li key={slice.key}>
              <button
                type="button"
                onClick={() => onSelect(isSelected ? "" : String(slice.key))}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                }`}
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-[3px]"
                  style={{
                    backgroundColor: slice.color,
                    opacity: slice.key === UNKNOWN_SLICE ? 0.45 : 0.9,
                  }}
                />
                <span className="flex-1 truncate">{slice.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {slice.count} siswa ({formatShare(slice.share)})
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-muted-foreground text-xs">
        Persentase dihitung terhadap seluruh {total} siswa kelas ini, termasuk yang belum dapat
        dinilai. Klik kategori untuk menyaring tabel siswa.
      </p>
    </div>
  )
}

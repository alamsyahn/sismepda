"use client"

import { useMemo, useState } from "react"

import { ChartTooltip, ChartTooltipFrame, isMousePointer } from "@/components/e-uks/chart-tooltip"
import { UNKNOWN_SLICE, type NutritionDistributionSlice } from "@/lib/euks-class-monitoring"
import { formatShare } from "@/lib/euks-nutrition"

/**
 * Distribusi status gizi sebagai bar bertumpuk 100%.
 *
 * Bar hanya ringkasan visual; angka sebenarnya selalu ada di legenda sebagai
 * teks, jadi status tidak pernah disampaikan lewat warna saja. Legenda juga
 * berfungsi sebagai penyaring tabel siswa di bawahnya.
 *
 * Ada dua state berbeda yang sengaja tidak digabung: `selected` adalah PENYARING
 * yang bertahan (milik pemanggil), sedangkan sorotan tooltip hanya sementara
 * selama hover/fokus. Menggabungkannya akan membuat hover ikut menyaring tabel.
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
  const [activeKey, setActiveKey] = useState<string | null>(null)

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

  // Titik tengah tiap irisan pada bar, dipakai untuk menempatkan tooltip.
  const offsets = visible.reduce<{ key: string; center: number }[]>((acc, slice, index) => {
    const before = visible.slice(0, index).reduce((sum, prev) => sum + prev.share, 0)
    acc.push({ key: String(slice.key), center: (before + slice.share / 2) / 100 })
    return acc
  }, [])

  const active = distribution.find((slice) => String(slice.key) === activeKey) ?? null
  const activeCenter = offsets.find((item) => item.key === activeKey)?.center ?? 0.5
  const clear = (key: string) => setActiveKey((current) => (current === key ? null : current))

  return (
    <div className="space-y-4">
      <ChartTooltipFrame>
        <div
          className="border-border/60 flex h-6 w-full overflow-hidden rounded-full border"
          role="img"
          aria-label={`Distribusi status gizi: ${visible
            .map((slice) => `${slice.label} ${slice.count} siswa (${formatShare(slice.share)})`)
            .join(", ")}`}
        >
          {visible.map((slice) => {
            const key = String(slice.key)
            const isActive = key === activeKey
            const isUnknown = slice.key === UNKNOWN_SLICE
            return (
              <div
                key={slice.key}
                className="h-full transition-opacity"
                style={{
                  width: `${slice.share}%`,
                  // Irisan "Belum dapat dinilai" memakai warna teredam agar tidak
                  // terbaca sebagai kategori gizi keenam.
                  backgroundColor: slice.color,
                  opacity: isUnknown
                    ? isActive
                      ? 0.55
                      : 0.35
                    : isActive
                      ? 1
                      : activeKey === null
                        ? 0.85
                        : 0.5,
                }}
                onPointerEnter={() => setActiveKey(key)}
                onPointerDown={() => setActiveKey(key)}
                onPointerLeave={(event) => {
                  if (isMousePointer(event)) clear(key)
                }}
              >
                <span className="sr-only">{`${slice.label}: ${slice.count} siswa (${formatShare(slice.share)})`}</span>
              </div>
            )
          })}
        </div>

        {active ? (
          <ChartTooltip
            xRatio={activeCenter}
            // Bar hanya setinggi 24px; jangkarnya diletakkan di tepi atas bar
            // supaya tooltip muncul di atasnya, tidak menutupi bar.
            yRatio={0}
            title={active.label}
            value={`${active.count} siswa`}
            rows={[`${formatShare(active.share)} dari ${total} siswa kelas ini`]}
          />
        ) : null}
      </ChartTooltipFrame>

      <ul className="grid gap-2 sm:grid-cols-2">
        {distribution.map((slice) => {
          const key = String(slice.key)
          const isSelected = selected === slice.key
          const isActive = key === activeKey
          return (
            <li key={slice.key}>
              <button
                type="button"
                onClick={() => onSelect(isSelected ? "" : key)}
                aria-pressed={isSelected}
                // Hover/fokus pada legenda ikut menegaskan irisan bar dan
                // memunculkan tooltipnya, sehingga irisan tipis tetap dapat
                // ditelusuri — termasuk lewat keyboard.
                onPointerEnter={() => setActiveKey(key)}
                onPointerLeave={(event) => {
                  if (isMousePointer(event)) clear(key)
                }}
                onFocus={() => setActiveKey(key)}
                onBlur={() => clear(key)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : isActive
                      ? "bg-accent/50"
                      : "hover:bg-accent/50"
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

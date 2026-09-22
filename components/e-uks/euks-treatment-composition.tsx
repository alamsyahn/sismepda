"use client"

import { useId, useState } from "react"

import {
  buildTreatmentComposition,
  formatShare,
  type CompositionSlice,
} from "@/lib/euks-treatment-composition"
import type { TrendCount } from "@/lib/euks-trends"
import { cn } from "@/lib/utils"

/**
 * Warna per urutan legenda: hijau utama, hijau lembut, aksen hangat, dan
 * netral untuk gabungan "Tindakan lainnya".
 *
 * Daftar ditulis utuh, bukan dirangkai dari potongan string, karena Tailwind
 * memindai kelas secara harfiah — kelas yang dibentuk saat berjalan tidak ikut
 * dibangun. Hijau memakai token E-UKS sehingga ikut berubah bersama tema;
 * aksen hangat dan netral dibuat tembus pandang di atas permukaan kartu supaya
 * tetap terbaca pada tema terang maupun gelap.
 */
const TONE_CLASSES = [
  "bg-euks-accent",
  "bg-euks-accent/55",
  "bg-amber-500/85 dark:bg-amber-400/80",
  "bg-muted-foreground/35",
] as const

function toneClass(tone: number): string {
  return TONE_CLASSES[Math.min(tone, TONE_CLASSES.length - 1)]
}

function sliceDescription(slice: CompositionSlice): string {
  return `${slice.label}, ${slice.count} kunjungan, ${formatShare(slice.share)}`
}

/**
 * Komposisi tindakan sebagai waffle: seratus kotak paling banyak, dibaca
 * sebagai bagian dari keseluruhan.
 *
 * Bentuk ini menggantikan peringkat titik karena pertanyaannya memang bukan
 * "mana yang terbesar" melainkan "seberapa besar porsinya" — dan posisi titik
 * pada lajur mudah disalahbaca sebagai tingkat atau skor.
 *
 * Kotak dibatasi seratus supaya tinggi kartu tidak tumbuh mengikuti jumlah
 * kunjungan. Di atas seratus, satu kotak mewakili sekitar satu persen, dan
 * keterangan di bawah grafik menyatakan hal itu secara eksplisit.
 *
 * Hanya kotak pertama tiap kategori yang menjadi perhentian papan tik. Seratus
 * perhentian berurutan akan menjebak pengguna papan tik di dalam satu grafik,
 * sementara semua yang bisa diketahui dari kotak ketujuh sudah tersedia pada
 * kotak pertama kategori yang sama. Kotak selebihnya tetap menampilkan tooltip
 * saat disentuh tetikus, dan disembunyikan dari pembaca layar agar keterangan
 * yang sama tidak dibacakan berulang.
 */
export function EuksTreatmentComposition({
  rows,
  emptyLabel,
}: {
  rows: TrendCount[]
  emptyLabel: string
}) {
  // Kategori yang dikunci lewat ketukan/klik pada legenda; `null` berarti
  // tidak ada yang dikunci. Dipisahkan dari sorotan sesaat agar perangkat
  // sentuh — yang tidak punya hover — tetap bisa menyalakan sorotan.
  const [pinned, setPinned] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const statusId = useId()

  const { slices, total, boxes, approximate } = buildTreatmentComposition(rows)

  if (slices.length === 0 || total === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>
  }

  const active = hovered ?? pinned
  const activeSlice = active ? (slices.find((slice) => slice.key === active) ?? null) : null

  const boxNote = approximate
    ? "Setiap kotak mewakili sekitar 1% kunjungan."
    : "Setiap kotak mewakili 1 kunjungan."

  // Indeks kotak pertama tiap kategori — satu-satunya yang dapat difokus.
  const firstBoxIndex = new Map<string, number>()
  boxes.forEach((key, index) => {
    if (!firstBoxIndex.has(key)) firstBoxIndex.set(key, index)
  })

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {slices.map((slice) => {
          const isActive = active === slice.key
          const isPinned = pinned === slice.key
          return (
            <li key={slice.key}>
              <button
                type="button"
                aria-pressed={isPinned}
                className={cn(
                  "focus-visible:ring-ring flex w-full items-start gap-2.5 rounded-md px-1.5 py-1 text-left text-sm transition-opacity focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none",
                  "hover:bg-muted/60",
                  active && !isActive ? "opacity-45" : "opacity-100",
                )}
                onClick={() => setPinned(isPinned ? null : slice.key)}
                onPointerEnter={() => setHovered(slice.key)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(slice.key)}
                onBlur={() => setHovered(null)}
              >
                <span
                  aria-hidden="true"
                  className={cn("mt-1 size-3 shrink-0 rounded-[3px]", toneClass(slice.tone))}
                />
                <span className="min-w-0 flex-1 text-pretty break-words">
                  {slice.label}
                  {slice.merged.length > 0 ? (
                    <span className="text-muted-foreground block text-xs">
                      Gabungan {slice.merged.length} tindakan lain
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="font-semibold">{slice.count}</span>{" "}
                  <span className="text-muted-foreground text-xs">{formatShare(slice.share)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* Lebar kotak dikunci lewat kolom otomatis, bukan jumlah kolom tetap:
          grid menyesuaikan lebar kartu tanpa mengubah ukuran tiap kotak. */}
      <div
        role="img"
        aria-label={`Komposisi tindakan dari ${total} entri tindakan. ${slices
          .map(sliceDescription)
          .join(". ")}.`}
        className="grid grid-cols-[repeat(auto-fill,minmax(0.75rem,1fr))] gap-1"
      >
        {boxes.map((key, index) => {
          const slice = slices.find((item) => item.key === key)
          if (!slice) return null
          const isFirst = firstBoxIndex.get(key) === index
          const isActive = active === key
          return (
            <span
              key={`${key}-${index}`}
              title={sliceDescription(slice)}
              tabIndex={isFirst ? 0 : -1}
              aria-hidden={isFirst ? undefined : "true"}
              aria-label={isFirst ? sliceDescription(slice) : undefined}
              className={cn(
                "focus-visible:ring-ring aspect-square rounded-[3px] transition-opacity focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none",
                toneClass(slice.tone),
                active && !isActive ? "opacity-30" : "opacity-100",
              )}
              onPointerEnter={() => setHovered(key)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(key)}
              onBlur={() => setHovered(null)}
            />
          )
        })}
      </div>

      {/* Keterangan kategori yang sedang disorot. Warna saja tidak cukup:
          baris ini menyebut namanya, dan diumumkan dengan sopan. */}
      <p id={statusId} aria-live="polite" className="text-muted-foreground text-xs">
        {activeSlice ? sliceDescription(activeSlice) : boxNote}
      </p>
    </div>
  )
}

import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { OTHER_TERMS_KEY, type TrendCount } from "@/lib/euks-trends"

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
 *
 * Ketika `onSelect` diberikan, tiap baris menjadi `<button>` sungguhan, bukan
 * `<div>` yang diberi penangan klik: hanya dengan begitu baris dapat dicapai
 * lewat papan ketik, punya cincin fokus, dan mengumumkan keadaan tertekannya.
 */
export function EuksComplaintRanking({
  rows,
  emptyLabel,
  selected,
  onSelect,
}: {
  rows: TrendCount[]
  emptyLabel: string
  /** Kunci baris yang sedang dipilih, bila panel ini interaktif. */
  selected?: string
  /** Dipanggil dengan kunci baris; tanpa ini panel hanya menampilkan data. */
  onSelect?: (key: string) => void
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>
  }

  // Skala relatif terhadap baris terbanyak agar perbedaan tetap terbaca ketika
  // seluruh angka kecil.
  const max = Math.max(...rows.map((row) => row.count))

  return (
    <ol className="space-y-1">
      {rows.map((row, index) => {
        const other = row.key === OTHER_TERMS_KEY
        const top = index < 3 && !other
        const isSelected = selected === row.key
        // `Lainnya` tetap dapat dipilih karena kelompoknya memang dapat
        // dipetakan: anggotanya adalah seluruh istilah di luar peringkat
        // teratas, ditentukan oleh perhitungan yang sama dengan peringkat ini.
        const interactive = onSelect !== undefined

        const body = (
          <div className="grid w-full grid-cols-[1.5rem_1fr] items-baseline gap-x-3 gap-y-1 text-left">
            <span
              className={cn(
                "text-sm tabular-nums",
                top ? "text-euks-accent font-semibold" : "text-muted-foreground",
              )}
            >
              {other ? "–" : `#${index + 1}`}
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {/* Dibiarkan membungkus, bukan dipotong: keluhan panjang harus
                    tetap terbaca utuh supaya artinya tidak hilang. */}
                <span
                  className={cn(
                    "inline-flex items-baseline gap-1.5 text-pretty",
                    isSelected || top ? "font-semibold" : "font-medium",
                  )}
                >
                  {/* Penanda terpilih tidak hanya warna: ada centang, tebal
                      huruf, latar, dan garis aksen di tepi. */}
                  {isSelected ? (
                    <Check className="text-euks-accent size-3.5 shrink-0 translate-y-0.5" aria-hidden />
                  ) : null}
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
                    opacity: isSelected ? 1 : top ? 0.9 : 0.55,
                  }}
                />
              </div>
            </div>
          </div>
        )

        return (
          <li key={row.key}>
            {interactive ? (
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(row.key)}
                className={cn(
                  "focus-visible:ring-ring/50 hover:bg-muted/50 w-full rounded-lg border-l-2 px-2 py-2 transition-colors focus-visible:ring-3 focus-visible:outline-none",
                  isSelected ? "border-l-euks-accent bg-muted/60" : "border-l-transparent",
                )}
              >
                {body}
              </button>
            ) : (
              <div className="px-2 py-2">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

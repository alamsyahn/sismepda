import type { TrendCount } from "@/lib/euks-trends"

/**
 * Peringkat tindakan sebagai lollipop: batang tipis sebagai tangkai, titik
 * pada posisi proporsional.
 *
 * Sengaja berbeda dari peringkat keluhan meski datanya sejenis. Ketika dua
 * kartu bersebelahan memakai bentuk yang persis sama, keduanya terbaca sebagai
 * satu blok berulang dan pembaca berhenti membedakan isinya. Perbandingan
 * peringkat tetap mudah karena posisi titik tetap proporsional terhadap nilai
 * terbesar, sama seperti panjang batang.
 *
 * Dibuat dengan elemen biasa dan CSS, bukan SVG dan bukan pustaka grafik:
 * bentuknya sederhana, dan dengan begitu teksnya tetap dapat dipilih serta
 * dibaca pembaca layar.
 */
export function EuksTreatmentRanking({
  rows,
  emptyLabel,
}: {
  rows: TrendCount[]
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>
  }

  const max = Math.max(...rows.map((row) => row.count))

  return (
    <ol className="space-y-3.5">
      {rows.map((row) => {
        const ratio = max === 0 ? 0 : row.count / max
        return (
          <li key={row.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-pretty">{row.label}</span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="font-semibold">{row.count}</span>{" "}
                <span className="text-muted-foreground text-xs">
                  {row.share.toFixed(1).replace(".", ",")}%
                </span>
              </span>
            </div>
            {/* Tangkai netral sepanjang lajur + titik aksen pada posisi nilai.
                Titik diberi transform agar tidak terpotong di kedua ujung. */}
            <div className="relative h-3">
              <div className="bg-border absolute inset-x-0 top-1/2 h-px -translate-y-1/2" />
              <div
                className="bg-euks-accent absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${ratio * 100}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

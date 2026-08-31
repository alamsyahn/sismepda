import { PieChart } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { categoryBreakdown, formatRupiahCompact, type CategoryTotal } from "@/lib/bos"

/** Muted, low-chroma palette — five tones plus a neutral for "Lainnya". */
const tones = [
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-1)",
  "var(--chart-4)",
  "var(--chart-5)",
]

/**
 * Storage-breakdown style visual: plain horizontal bars, no axis or grid.
 * Bar length is relative to the largest category so it reads at a glance.
 */
export function BosBreakdownCard({ totals }: { totals: CategoryTotal[] }) {
  const slices = categoryBreakdown(totals)

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>Pengeluaran Terbesar</CardTitle>
        <CardDescription>Lima kategori dengan realisasi tertinggi, sisanya digabung.</CardDescription>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <PieChart className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              Belum ada realisasi yang bisa ditampilkan.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {slices.map((slice, index) => (
              <li key={slice.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-foreground">{slice.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatRupiahCompact(slice.total)}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(slice.share, 2)}%`,
                      backgroundColor:
                        slice.key === "lainnya" ? "var(--muted-foreground)" : tones[index % tones.length],
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

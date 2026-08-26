import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function StudentAttendanceTrend({ data }: { data: Array<{ key: string; label: string; hadir: number; tidakHadir: number }> }) {
  const recent = data.slice(-6)
  const max = Math.max(1, ...recent.flatMap((item) => [item.hadir, item.tidakHadir]))
  return (
    <Card className="border-border/70">
      <CardHeader><CardTitle>Tren Kehadiran</CardTitle><CardDescription>Perbandingan hadir dan tidak hadir dalam enam bulan terakhir yang tercatat.</CardDescription></CardHeader>
      <CardContent>
        {recent.length === 0 ? <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">Belum ada data untuk ditampilkan.</div> : (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--chart-1)]" />Hadir</span><span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--chart-5)]" />Tidak hadir</span></div>
            <div className="grid h-48 grid-cols-6 items-end gap-3 border-b border-border pb-2">
              {recent.map((item) => <div key={item.key} className="flex h-full min-w-0 flex-col justify-end gap-2" aria-label={`${item.label}: ${item.hadir} hadir, ${item.tidakHadir} tidak hadir`}><div className="flex flex-1 items-end justify-center gap-1" aria-hidden="true"><div title={`${item.hadir} hadir`} className="w-3 rounded-t bg-[var(--chart-1)]/85 sm:w-5" style={{ height: `${Math.max(item.hadir ? 8 : 0, item.hadir / max * 100)}%` }} /><div title={`${item.tidakHadir} tidak hadir`} className="w-3 rounded-t bg-[var(--chart-5)]/75 sm:w-5" style={{ height: `${Math.max(item.tidakHadir ? 8 : 0, item.tidakHadir / max * 100)}%` }} /></div><span className="truncate text-center text-xs text-muted-foreground">{item.label}</span></div>)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

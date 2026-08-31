"use client"

import { useState } from "react"
import { RotateCcw, TriangleAlert } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DEFAULT_STATUS_COLORS,
  STATUS_COLOR_LABELS,
  normalizeHexColor,
  similarColorWarnings,
  type AttendanceStatusColors,
} from "@/lib/attendance-status-colors"
import { TREND_STATUSES } from "@/lib/attendance-trend"

/**
 * Pengaturan warna status absensi. Nilai disimpan bersama pengaturan sekolah
 * lain melalui tombol "Simpan Perubahan" pada halaman Pengaturan.
 */
export function StatusColorSettings({
  colors,
  onChange,
}: {
  colors: AttendanceStatusColors
  onChange: (colors: AttendanceStatusColors) => void
}) {
  // Menyimpan teks mentah supaya admin bisa mengetik HEX sebagian.
  const [drafts, setDrafts] = useState<Partial<Record<string, string>>>({})
  const warnings = similarColorWarnings(colors)

  function updateColor(status: keyof AttendanceStatusColors, value: string) {
    setDrafts((current) => ({ ...current, [status]: value }))
    const normalized = normalizeHexColor(value)
    if (normalized) onChange({ ...colors, [status]: normalized })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Warna Status Absensi</CardTitle>
        <CardDescription>
          Warna berlaku global untuk semua pengguna dan dipakai pada seluruh grafik serta label status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-4">
          {TREND_STATUSES.map((status) => {
            const warning = warnings[status]
            return (
              <div key={status} className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-[160px_auto_1fr] sm:items-center">
                  <Label htmlFor={`color-${status}`}>{STATUS_COLOR_LABELS[status]}</Label>
                  <input
                    id={`color-${status}`}
                    type="color"
                    value={colors[status]}
                    onChange={(event) => updateColor(status, event.target.value)}
                    className="h-9 w-14 cursor-pointer rounded-md border border-border bg-card p-1"
                    aria-label={`Pilih warna ${STATUS_COLOR_LABELS[status]}`}
                  />
                  <Input
                    value={drafts[status] ?? colors[status]}
                    onChange={(event) => updateColor(status, event.target.value)}
                    onBlur={() => setDrafts((current) => ({ ...current, [status]: undefined }))}
                    maxLength={7}
                    className="bg-card font-mono uppercase sm:max-w-40"
                    aria-label={`Kode HEX warna ${STATUS_COLOR_LABELS[status]}`}
                  />
                </div>
                {warning ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{warning}</span>
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-sm font-medium">Pratinjau</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {TREND_STATUSES.map((status) => (
              <span key={status} className="flex items-center gap-2 text-sm">
                <span className="size-3 rounded-full" style={{ backgroundColor: colors[status] }} aria-hidden />
                {STATUS_COLOR_LABELS[status]}
              </span>
            ))}
          </div>
          <div className="flex h-8 w-full max-w-md overflow-hidden rounded-md" role="img" aria-label="Contoh batang bertumpuk dengan warna yang dipilih">
            {TREND_STATUSES.map((status) => (
              <span key={status} className="flex-1" style={{ backgroundColor: colors[status] }} />
            ))}
          </div>
        </div>

        <Button type="button" variant="outline" onClick={() => { setDrafts({}); onChange({ ...DEFAULT_STATUS_COLORS }) }}>
          <RotateCcw className="size-4" />Kembalikan ke warna default
        </Button>
      </CardContent>
    </Card>
  )
}

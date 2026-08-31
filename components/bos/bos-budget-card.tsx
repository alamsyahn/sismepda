"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Check, Loader2, Pencil, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatPercent, formatRupiah, type BosSummary } from "@/lib/bos"

/** Digits-only view of a rupiah input, grouped for readability while typing. */
function groupDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  if (!digits) return ""
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

function digitsToNumber(value: string): number {
  const digits = value.replace(/\D/g, "")
  return digits ? Number(digits) : 0
}

export function BosBudgetCard({ summary, canEdit }: { summary: BosSummary; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState("")

  function startEdit() {
    setDraft(summary.initialBudget === null ? "" : groupDigits(String(summary.initialBudget)))
    setEditing(true)
  }

  async function save() {
    const value = digitsToNumber(draft)
    setSaving(true)
    try {
      const response = await fetch("/api/bos/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialBudget: value }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Anggaran gagal disimpan")
      toast.success("Anggaran awal diperbarui")
      setEditing(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Anggaran gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  const percent = summary.percentUsed ?? 0
  const tone = summary.overspent ? "var(--destructive)" : "var(--primary)"

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>Penggunaan Dana BOS</CardTitle>
        <CardDescription>Serapan anggaran terhadap pagu awal tahun berjalan.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <BudgetDonut percent={percent} tone={tone} budgetSet={summary.budgetSet} />

          <dl className="w-full space-y-3">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm text-muted-foreground">Anggaran Awal</dt>
              <dd className="flex min-w-0 items-center gap-1.5">
                {editing ? (
                  <>
                    <Input
                      autoFocus
                      inputMode="numeric"
                      value={draft}
                      aria-label="Anggaran awal"
                      onChange={(event) => setDraft(groupDigits(event.target.value))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); void save() }
                        if (event.key === "Escape") setEditing(false)
                      }}
                      className="h-8 w-40 text-right tabular-nums"
                    />
                    <Button size="icon-sm" variant="ghost" disabled={saving} onClick={() => void save()} aria-label="Simpan anggaran">
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    </Button>
                    <Button size="icon-sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)} aria-label="Batalkan perubahan anggaran">
                      <X className="size-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {summary.budgetSet ? formatRupiah(summary.initialBudget ?? 0) : "Belum diisi"}
                    </span>
                    {canEdit ? (
                      <Button size="icon-sm" variant="ghost" onClick={startEdit} aria-label="Ubah anggaran awal">
                        <Pencil className="size-3.5" />
                      </Button>
                    ) : null}
                  </>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm text-muted-foreground">Terealisasi</dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground">
                {formatRupiah(summary.totalRealisasi)}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <dt className="text-sm text-muted-foreground">Sisa</dt>
              <dd
                className={`text-sm font-semibold tabular-nums ${summary.overspent ? "text-destructive" : "text-foreground"}`}
              >
                {summary.remaining === null ? "—" : formatRupiah(summary.remaining)}
              </dd>
            </div>
          </dl>
        </div>

        {!summary.budgetSet ? (
          <p className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            {canEdit
              ? "Anggaran awal belum diisi. Klik ikon pensil untuk menetapkan pagu BOS."
              : "Anggaran awal belum diisi oleh pengelola BOS."}
          </p>
        ) : null}

        {summary.overspent ? (
          <p className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Realisasi melebihi anggaran sebesar {formatRupiah(Math.abs(summary.remaining ?? 0))}.
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Single-arc donut; the arc caps at a full circle while the label keeps the true %. */
function BudgetDonut({ percent, tone, budgetSet }: { percent: number; tone: string; budgetSet: boolean }) {
  const size = 172
  const thickness = 20
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2
  const filled = Math.min(Math.max(percent, 0), 100) / 100
  const dash = circumference * filled

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={budgetSet ? `Terserap ${formatPercent(percent)}` : "Anggaran belum diisi"}
      >
        <g transform={`rotate(-90 ${center} ${center})`}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--muted)" strokeWidth={thickness} />
          {budgetSet && dash > 0 ? (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={tone}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeLinecap="butt"
              className="transition-all duration-500"
            />
          ) : null}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none tracking-tight text-foreground tabular-nums">
          {budgetSet ? formatPercent(percent) : "—"}
        </span>
        <span className="mt-1 text-xs font-medium text-muted-foreground">Terserap</span>
      </div>
    </div>
  )
}

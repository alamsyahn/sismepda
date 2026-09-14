"use client"

import { useEffect, useState } from "react"
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { describeFormats } from "@/lib/upload-policy"
import {
  UPLOAD_CATEGORY_LABELS,
  bytesToMb,
  formatBytes,
  mbToBytes,
  type UploadCategory,
} from "@/lib/upload-slots"

/**
 * Pengaturan batas ukuran unggah.
 *
 * Daftar slot TIDAK ditulis di sini. Komponen ini merender apa pun yang
 * dikirim `/api/admin/upload-policy`, yang menyusunnya dari registry kode.
 * Karena itu mendaftarkan slot baru di lib/upload-slots.ts langsung
 * memunculkannya di halaman ini — tanpa menyentuh berkas UI mana pun.
 * Pengelompokan pun memakai metadata `module` dari registry, bukan daftar
 * modul yang ditulis ulang di halaman.
 */

type GlobalRow = {
  category: UploadCategory
  maxBytes: number
  isCustom: boolean
  defaultMaxBytes: number
}

type SlotRow = {
  key: string
  label: string
  module: string
  category: UploadCategory
  description: string | null
  allowedMimeTypes: string[] | null
  maxBytes: number
  isCustom: boolean
  defaultMaxBytes: number
}

type PolicyResponse = {
  globals: GlobalRow[]
  slots: SlotRow[]
  limits: { minBytes: number; maxBytes: number }
}

export function UploadPolicySettings() {
  const [data, setData] = useState<PolicyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    fetch("/api/admin/upload-policy", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        return (await response.json()) as PolicyResponse
      })
      .then((payload) => {
        if (active) setData(payload)
      })
      .catch(() => {
        if (active) toast.error("Pengaturan unggah gagal dimuat")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function submit(body: unknown, key: string) {
    setBusyKey(key)
    try {
      const response = await fetch("/api/admin/upload-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? "Pengaturan unggah gagal disimpan")
        return
      }
      setData(payload as PolicyResponse)
      setDrafts((current) => ({ ...current, [key]: "" }))
      toast.success("Batas unggah diperbarui")
    } catch {
      toast.error("Pengaturan unggah gagal disimpan")
    } finally {
      setBusyKey(null)
    }
  }

  /** MB dari input diubah ke byte di sini; byte tetap satu-satunya otoritas. */
  function parseDraft(key: string, fallbackBytes: number): number | null {
    const raw = drafts[key]
    if (raw === undefined || raw.trim() === "") return fallbackBytes
    const mb = Number(raw.replace(",", "."))
    if (!Number.isFinite(mb) || mb <= 0) {
      toast.error("Masukkan angka MB yang valid")
      return null
    }
    return mbToBytes(mb)
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pengaturan Unggah</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Memuat batas unggah…
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  // Pengelompokan lahir dari metadata registry, sehingga modul baru muncul
  // sendiri tanpa perubahan di berkas ini.
  const groups = new Map<string, SlotRow[]>()
  for (const slot of data.slots) {
    const list = groups.get(slot.module) ?? []
    list.push(slot)
    groups.set(slot.module, list)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pengaturan Unggah</CardTitle>
        <CardDescription>
          Batas ukuran berkas untuk setiap bagian yang menerima unggahan. Berkas yang sudah
          tersimpan tetap berlaku meskipun batasnya diturunkan; batas baru hanya berlaku untuk
          unggahan berikutnya, termasuk saat mengganti berkas lama.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Default Global</h3>
          <p className="text-xs text-muted-foreground">
            Dipakai oleh bagian yang tidak memiliki batas sendiri.
          </p>
          {data.globals.map((row) => (
            <LimitRow
              key={row.category}
              rowKey={`global.${row.category}`}
              title={UPLOAD_CATEGORY_LABELS[row.category]}
              maxBytes={row.maxBytes}
              isCustom={row.isCustom}
              defaultMaxBytes={row.defaultMaxBytes}
              busy={busyKey === `global.${row.category}`}
              draft={drafts[`global.${row.category}`] ?? ""}
              onDraftChange={(value) =>
                setDrafts((current) => ({ ...current, [`global.${row.category}`]: value }))
              }
              onSave={() => {
                const bytes = parseDraft(`global.${row.category}`, row.maxBytes)
                if (bytes === null) return
                void submit({ globals: { [row.category]: bytes } }, `global.${row.category}`)
              }}
              onReset={() =>
                void submit({ globals: { [row.category]: null } }, `global.${row.category}`)
              }
            />
          ))}
        </section>

        <Separator />

        {[...groups.entries()].map(([moduleName, slots]) => (
          <section key={moduleName} className="space-y-3">
            <h3 className="text-sm font-semibold">{moduleName}</h3>
            {slots.map((slot) => (
              <LimitRow
                key={slot.key}
                rowKey={slot.key}
                title={slot.label}
                subtitle={slot.description}
                formats={slot.allowedMimeTypes}
                maxBytes={slot.maxBytes}
                isCustom={slot.isCustom}
                defaultMaxBytes={slot.defaultMaxBytes}
                busy={busyKey === slot.key}
                draft={drafts[slot.key] ?? ""}
                onDraftChange={(value) =>
                  setDrafts((current) => ({ ...current, [slot.key]: value }))
                }
                onSave={() => {
                  const bytes = parseDraft(slot.key, slot.maxBytes)
                  if (bytes === null) return
                  void submit({ slots: { [slot.key]: bytes } }, slot.key)
                }}
                onReset={() => void submit({ slots: { [slot.key]: null } }, slot.key)}
              />
            ))}
          </section>
        ))}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Batas yang terlalu besar membuat satu unggahan menahan memori server dalam jumlah
            besar. Nilai di luar {formatBytes(data.limits.minBytes)}–
            {formatBytes(data.limits.maxBytes)} ditolak.
          </span>
        </p>
      </CardContent>
    </Card>
  )
}

function LimitRow({
  rowKey,
  title,
  subtitle,
  formats,
  maxBytes,
  isCustom,
  defaultMaxBytes,
  busy,
  draft,
  onDraftChange,
  onSave,
  onReset,
}: {
  rowKey: string
  title: string
  subtitle?: string | null
  formats?: string[] | null
  maxBytes: number
  isCustom: boolean
  defaultMaxBytes: number
  busy: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSave: () => void
  onReset: () => void
}) {
  const inputId = `upload-limit-${rowKey}`
  return (
    <div className="rounded-lg border border-border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={inputId} className="text-sm font-medium">
              {title}
            </Label>
            <Badge variant={isCustom ? "default" : "secondary"}>
              {isCustom ? "Custom" : "Default"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Maksimum saat ini {formatBytes(maxBytes)}
            {formats?.length ? ` · Format ${describeFormats(formats)}` : ""}
          </p>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          inputMode="decimal"
          className="w-28 bg-card"
          placeholder={String(bytesToMb(maxBytes))}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          aria-label={`Batas ${title} dalam MB`}
        />
        <span className="text-xs text-muted-foreground">MB</span>
        <Button type="button" size="sm" onClick={onSave} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Simpan
        </Button>
        {isCustom ? (
          <Button type="button" size="sm" variant="outline" onClick={onReset} disabled={busy}>
            <RotateCcw className="size-4" aria-hidden />
            Gunakan Default ({formatBytes(defaultMaxBytes)})
          </Button>
        ) : null}
      </div>
    </div>
  )
}

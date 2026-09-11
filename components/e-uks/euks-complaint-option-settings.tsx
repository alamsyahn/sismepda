"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { COMPLAINT_LABEL_MAX } from "@/lib/euks-settings"

export type ComplaintOptionRow = {
  id: string
  label: string
  active: boolean
  sortOrder: number
}

export function EuksComplaintOptionSettings({ options }: { options: ComplaintOptionRow[] }) {
  const router = useRouter()
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)

  const send = async (init: RequestInit, failure: string) => {
    setBusy(true)
    try {
      const response = await fetch("/api/e-uks/complaint-options", {
        headers: { "Content-Type": "application/json" },
        ...init,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? failure)
      router.refresh()
      return body
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure)
      return null
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (label.trim().length < 2) return toast.error("Keluhan wajib diisi")
    const body = await send(
      { method: "POST", body: JSON.stringify({ label: label.trim() }) },
      "Gagal menambah pilihan keluhan",
    )
    if (body) {
      toast.success(body.reused ? `"${body.label}" sudah ada dan diaktifkan kembali` : "Pilihan keluhan ditambahkan")
      setLabel("")
    }
  }

  const toggle = async (option: ComplaintOptionRow, active: boolean) => {
    const body = await send(
      { method: "PATCH", body: JSON.stringify({ id: option.id, active }) },
      "Gagal memperbarui pilihan keluhan",
    )
    if (body) toast.success(active ? "Pilihan ditampilkan" : "Pilihan disembunyikan")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pilihan Keluhan</CardTitle>
        <CardDescription>
          Menyeragamkan penulisan agar statistik tidak terpecah. Petugas tetap boleh mengetik
          keluhan di luar daftar ini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="euks-complaint-label">Keluhan</Label>
            <Input
              id="euks-complaint-label"
              value={label}
              maxLength={COMPLAINT_LABEL_MAX}
              placeholder="Demam"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <Button onClick={add} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Tambah
          </Button>
        </div>

        {options.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Belum ada pilihan keluhan. Selama daftar kosong, form kunjungan tetap memakai isian
            bebas seperti sebelumnya.
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {options.map((option) => (
              <li key={option.id} className="flex items-center gap-3 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</p>
                <Switch
                  checked={option.active}
                  disabled={busy}
                  aria-label={`Tampilkan ${option.label}`}
                  onCheckedChange={(checked) => toggle(option, Boolean(checked))}
                />
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground text-xs">
          Mengubah label di sini tidak menulis ulang keluhan pada kunjungan yang sudah tercatat —
          riwayat tetap menunjukkan apa yang dicatat saat itu.
        </p>
      </CardContent>
    </Card>
  )
}

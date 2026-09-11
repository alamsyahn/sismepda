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
import {
  FACILITY_NAME_MAX,
  FACILITY_NOTE_MAX,
  FACILITY_QUANTITY_MAX,
} from "@/lib/euks-settings"

export type FacilityRow = {
  id: string
  name: string
  quantity: number | null
  note: string | null
  active: boolean
  sortOrder: number
}

export function EuksFacilitySettings({ facilities }: { facilities: FacilityRow[] }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [quantity, setQuantity] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const send = async (init: RequestInit, failure: string) => {
    setBusy(true)
    try {
      const response = await fetch("/api/e-uks/facilities", {
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
    if (name.trim().length < 2) return toast.error("Nama fasilitas wajib diisi")

    const parsed = quantity.trim() === "" ? null : Number(quantity)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > FACILITY_QUANTITY_MAX)) {
      return toast.error(`Jumlah harus bilangan bulat 0–${FACILITY_QUANTITY_MAX}`)
    }

    const body = await send(
      {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), quantity: parsed, note: note.trim() }),
      },
      "Gagal menambah fasilitas",
    )
    if (body) {
      // Server memulihkan entri lama alih-alih membuat duplikat; katakan apa
      // adanya supaya admin tidak bingung mencari entri barunya.
      toast.success(body.reused ? `"${body.name}" sudah ada dan diaktifkan kembali` : "Fasilitas ditambahkan")
      setName("")
      setQuantity("")
      setNote("")
    }
  }

  const toggle = async (facility: FacilityRow, active: boolean) => {
    const body = await send(
      { method: "PATCH", body: JSON.stringify({ id: facility.id, active }) },
      "Gagal memperbarui fasilitas",
    )
    if (body) toast.success(active ? "Fasilitas ditampilkan" : "Fasilitas disembunyikan")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fasilitas UKS</CardTitle>
        <CardDescription>
          Daftar informatif untuk Halaman Utama. Stok barang tetap dikelola di modul Sarpras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_7rem_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="euks-facility-name">Nama</Label>
            <Input
              id="euks-facility-name"
              value={name}
              maxLength={FACILITY_NAME_MAX}
              placeholder="Tempat tidur periksa"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="euks-facility-quantity">Jumlah</Label>
            <Input
              id="euks-facility-quantity"
              value={quantity}
              inputMode="numeric"
              placeholder="opsional"
              onChange={(event) => setQuantity(event.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="euks-facility-note">Keterangan</Label>
            <Input
              id="euks-facility-note"
              value={note}
              maxLength={FACILITY_NOTE_MAX}
              placeholder="opsional"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <Button onClick={add} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Tambah
          </Button>
        </div>

        {facilities.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Belum ada fasilitas yang terdaftar.
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {facilities.map((facility) => (
              <li key={facility.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {facility.name}
                    {facility.quantity !== null ? (
                      <span className="text-muted-foreground font-normal"> · {facility.quantity} unit</span>
                    ) : null}
                  </p>
                  {facility.note ? (
                    <p className="text-muted-foreground truncate text-xs">{facility.note}</p>
                  ) : null}
                </div>
                <Switch
                  checked={facility.active}
                  disabled={busy}
                  aria-label={`Tampilkan ${facility.name}`}
                  onCheckedChange={(checked) => toggle(facility, Boolean(checked))}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

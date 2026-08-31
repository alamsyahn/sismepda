"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  buildLocationTree,
  canReparent,
  flattenLocationTree,
  locationPath,
} from "@/lib/sarpras"
import type { SarprasLocationRow } from "@/lib/server-sarpras"

export type LocationDraft = {
  id?: string
  name: string
  parentId: string | null
  sortOrder: string
}

export function emptyLocationDraft(parentId: string | null = null): LocationDraft {
  return { name: "", parentId, sortOrder: "0" }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: LocationDraft
  locations: SarprasLocationRow[]
  onSaved: () => void
}

/** Create/edit/move one location node in the tree. */
export function SarprasLocationDialog({
  open,
  onOpenChange,
  draft,
  locations,
  onSaved,
}: Props) {
  const [form, setForm] = useState<LocationDraft>(draft)
  const [saving, setSaving] = useState(false)
  const editing = Boolean(form.id)

  const [seed, setSeed] = useState(draft)
  if (seed !== draft) {
    setSeed(draft)
    setForm(draft)
  }

  // When editing, a node's own subtree is excluded from the parent options —
  // moving a branch inside itself would detach it from the tree entirely.
  const parentOptions = flattenLocationTree(buildLocationTree(locations)).filter((location) =>
    form.id ? canReparent(locations, form.id, location.id) : true,
  )

  async function save() {
    const name = form.name.trim()
    if (name.length === 0) return toast.error("Nama lokasi wajib diisi")

    setSaving(true)
    try {
      const response = await fetch("/api/sarpras/locations", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing ? { id: form.id } : {}),
          name,
          parentId: form.parentId,
          sortOrder: Number(form.sortOrder.replace(/\D/g, "")) || 0,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Lokasi gagal disimpan")
      toast.success(editing ? "Lokasi diperbarui" : "Lokasi ditambahkan")
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lokasi gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) onOpenChange(value)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Lokasi" : "Tambah Lokasi"}</DialogTitle>
          <DialogDescription>
            Lokasi dapat bertingkat bebas, misalnya Gedung → Lantai → Ruang.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="location-name">Nama Lokasi *</Label>
            <Input
              id="location-name"
              value={form.name}
              placeholder="Contoh: VII A, Laboratorium IPA, Aula"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location-parent">Induk</Label>
            <select
              id="location-parent"
              value={form.parentId ?? ""}
              onChange={(event) =>
                setForm((current) => ({ ...current, parentId: event.target.value || null }))
              }
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">— Lokasi utama —</option>
              {parentOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationPath(locations, location.id)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location-order">Urutan Tampil</Label>
            <Input
              id="location-order"
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sortOrder: event.target.value.replace(/\D/g, ""),
                }))
              }
              className="text-right tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              Angka lebih kecil tampil lebih dahulu.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

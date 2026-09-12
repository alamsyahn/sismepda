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
import { SarprasItemTypeCombobox } from "@/components/sarpras/sarpras-item-type-combobox"
import { cn } from "@/lib/utils"
import {
  flattenLocationTree,
  locationPath,
  quantityError,
  type SarprasPriority,
} from "@/lib/sarpras"
import { buildLocationTree } from "@/lib/sarpras"
import type { SarprasItemTypeOption, SarprasLocationRow } from "@/lib/server-sarpras"

export type ItemDraft = {
  id?: string
  locationId: string
  itemTypeId: string
  targetQuantity: string
  availableQuantity: string
  goodQuantity: string
  moderateQuantity: string
  repairQuantity: string
  acquisitionDate: string
  inventoryCode: string
  description: string
  priority: "" | SarprasPriority
}

export function emptyItemDraft(locationId = ""): ItemDraft {
  return {
    locationId,
    itemTypeId: "",
    targetQuantity: "1",
    availableQuantity: "0",
    goodQuantity: "0",
    moderateQuantity: "0",
    repairQuantity: "0",
    acquisitionDate: "",
    inventoryCode: "",
    description: "",
    priority: "",
  }
}

/** Digits only; empty string reads as 0 so a cleared field never becomes NaN. */
function toNumber(value: string): number {
  const parsed = Number(value.replace(/\D/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function digits(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: ItemDraft
  locations: SarprasLocationRow[]
  itemTypes: SarprasItemTypeOption[]
  canCreateItemType: boolean
  onItemTypeCreated: (itemType: SarprasItemTypeOption) => void
  onSaved: () => void
}

/** Create/edit form for one item at one location. */
export function SarprasItemDialog({
  open,
  onOpenChange,
  draft,
  locations,
  itemTypes,
  canCreateItemType,
  onItemTypeCreated,
  onSaved,
}: Props) {
  const [form, setForm] = useState<ItemDraft>(draft)
  const [saving, setSaving] = useState(false)
  const editing = Boolean(form.id)

  // Re-seed whenever a different item (or a fresh create) is opened.
  const [seed, setSeed] = useState(draft)
  if (seed !== draft) {
    setSeed(draft)
    setForm(draft)
  }

  const quantities = {
    targetQuantity: toNumber(form.targetQuantity),
    availableQuantity: toNumber(form.availableQuantity),
    goodQuantity: toNumber(form.goodQuantity),
    moderateQuantity: toNumber(form.moderateQuantity),
    repairQuantity: toNumber(form.repairQuantity),
  }
  // Shown live under the condition fields, so the rule is learnable, not a
  // surprise on submit. The server re-checks it regardless.
  const conditionSum =
    quantities.goodQuantity + quantities.moderateQuantity + quantities.repairQuantity
  const validationMessage = quantityError(quantities)
  const surplus = quantities.availableQuantity > quantities.targetQuantity

  const orderedLocations = flattenLocationTree(buildLocationTree(locations))

  async function createItemType(name: string): Promise<SarprasItemTypeOption | null> {
    try {
      const response = await fetch("/api/sarpras/item-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Jenis barang gagal dibuat")
      const itemType: SarprasItemTypeOption = {
        id: data.id,
        name: data.name,
        active: data.active,
      }
      onItemTypeCreated(itemType)
      toast.success(
        data.reused
          ? `Jenis barang "${itemType.name}" sudah ada dan dipilih`
          : `Jenis barang "${itemType.name}" dibuat`,
      )
      return itemType
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Jenis barang gagal dibuat")
      return null
    }
  }

  async function save() {
    if (!form.locationId) return toast.error("Lokasi wajib dipilih")
    if (!form.itemTypeId) return toast.error("Jenis barang wajib dipilih")
    if (validationMessage) return toast.error(validationMessage)

    setSaving(true)
    try {
      const response = await fetch("/api/sarpras/items", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing ? { id: form.id } : {}),
          locationId: form.locationId,
          itemTypeId: form.itemTypeId,
          ...quantities,
          acquisitionDate: form.acquisitionDate || null,
          inventoryCode: form.inventoryCode.trim() || null,
          description: form.description.trim() || null,
          priority: form.priority || null,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Barang gagal disimpan")
      toast.success(editing ? "Data barang diperbarui" : "Barang ditambahkan")
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Barang gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  const conditionFields = [
    { key: "goodQuantity", label: "Baik" },
    { key: "moderateQuantity", label: "Sedang" },
    { key: "repairQuantity", label: "Perlu Perbaikan" },
  ] as const

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Barang" : "Tambah Barang"}</DialogTitle>
          <DialogDescription>
            Catat kebutuhan, jumlah tersedia, dan rincian kondisi barang pada lokasi ini.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sarpras-type">Jenis Barang *</Label>
              <SarprasItemTypeCombobox
                id="sarpras-type"
                value={form.itemTypeId}
                itemTypes={itemTypes}
                canCreate={canCreateItemType}
                onChange={(itemTypeId) => setForm((current) => ({ ...current, itemTypeId }))}
                onCreate={createItemType}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sarpras-location">Lokasi *</Label>
              <select
                id="sarpras-location"
                value={form.locationId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, locationId: event.target.value }))
                }
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Pilih lokasi</option>
                {orderedLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {locationPath(locations, location.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sarpras-target">Kebutuhan (target) *</Label>
              <Input
                id="sarpras-target"
                inputMode="numeric"
                value={form.targetQuantity}
                onChange={(event) =>
                  setForm((current) => ({ ...current, targetQuantity: digits(event.target.value) }))
                }
                className="text-right tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sarpras-available">Jumlah Tersedia *</Label>
              <Input
                id="sarpras-available"
                inputMode="numeric"
                value={form.availableQuantity}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    availableQuantity: digits(event.target.value),
                  }))
                }
                className="text-right tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border/70 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Rincian Kondisi</Label>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  conditionSum === quantities.availableQuantity
                    ? "text-muted-foreground"
                    : "font-medium text-destructive",
                )}
              >
                {conditionSum} dari {quantities.availableQuantity} tersedia
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {conditionFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`sarpras-${field.key}`} className="text-xs text-muted-foreground">
                    {field.label}
                  </Label>
                  <Input
                    id={`sarpras-${field.key}`}
                    inputMode="numeric"
                    value={form[field.key]}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [field.key]: digits(event.target.value) }))
                    }
                    className="text-right tabular-nums"
                  />
                </div>
              ))}
            </div>
            {validationMessage ? (
              <p className="text-xs font-medium text-destructive">{validationMessage}</p>
            ) : surplus ? (
              <p className="text-xs text-muted-foreground">
                Jumlah tersedia melebihi kebutuhan — tercatat sebagai kelebihan
                {" "}{quantities.availableQuantity - quantities.targetQuantity} unit.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sarpras-date">Tanggal Pengadaan</Label>
              <Input
                id="sarpras-date"
                type="date"
                value={form.acquisitionDate}
                onChange={(event) =>
                  setForm((current) => ({ ...current, acquisitionDate: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sarpras-code">Kode Inventaris</Label>
              <Input
                id="sarpras-code"
                value={form.inventoryCode}
                placeholder="Opsional"
                onChange={(event) =>
                  setForm((current) => ({ ...current, inventoryCode: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sarpras-priority">Prioritas</Label>
              <select
                id="sarpras-priority"
                value={form.priority}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priority: event.target.value as ItemDraft["priority"],
                  }))
                }
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Tidak diatur</option>
                <option value="HIGH">Tinggi</option>
                <option value="MEDIUM">Sedang</option>
                <option value="LOW">Rendah</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sarpras-description">Keterangan</Label>
            <textarea
              id="sarpras-description"
              maxLength={2000}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Contoh: Warna proyeksi berubah, perlu kalibrasi"
              className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
          <Button onClick={() => void save()} disabled={saving || Boolean(validationMessage)}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

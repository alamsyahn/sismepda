"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { EllipsisVertical, ImagePlus, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { EuksPhotoField, EuksPhotoFrame } from "@/components/e-uks/euks-photo-field"
import {
  FACILITY_NAME_MAX,
  FACILITY_NOTE_MAX,
  FACILITY_QUANTITY_MAX,
  euksFacilityPhotoUrl,
} from "@/lib/euks-settings"

export type FacilityRow = {
  id: string
  name: string
  quantity: number | null
  note: string | null
  active: boolean
  sortOrder: number
  /** Null berarti belum berfoto; baris lama sebelum fitur ini selalu null. */
  photoUpdatedAt: Date | string | null
}

export function EuksFacilitySettings({ facilities }: { facilities: FacilityRow[] }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [quantity, setQuantity] = useState("")
  const [note, setNote] = useState("")
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [editTarget, setEditTarget] = useState<FacilityRow | null>(null)
  const [editName, setEditName] = useState("")
  const [editQuantity, setEditQuantity] = useState("")
  const [editNote, setEditNote] = useState("")
  const [editPhoto, setEditPhoto] = useState<File | null>(null)
  const [editPhotoCleared, setEditPhotoCleared] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<FacilityRow | null>(null)

  const send = async (init: RequestInit, failure: string) => {
    const response = await fetch("/api/e-uks/facilities", {
      headers: { "Content-Type": "application/json" },
      ...init,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? failure)
    return body
  }

  const uploadPhoto = async (facilityId: string, file: File) => {
    const data = new FormData()
    data.set("photo", file)
    const response = await fetch(`/api/e-uks/facilities/${facilityId}/photo`, {
      method: "PUT",
      body: data,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? "Foto gagal disimpan")
    }
  }

  const removePhoto = async (facilityId: string) => {
    const response = await fetch(`/api/e-uks/facilities/${facilityId}/photo`, { method: "DELETE" })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? "Foto gagal dihapus")
    }
  }

  const parseQuantity = (value: string): number | null | undefined => {
    if (value.trim() === "") return null
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > FACILITY_QUANTITY_MAX) return undefined
    return parsed
  }

  const add = async () => {
    if (name.trim().length < 2) return toast.error("Nama fasilitas wajib diisi")
    const parsed = parseQuantity(quantity)
    if (parsed === undefined) {
      return toast.error(`Jumlah harus bilangan bulat 0–${FACILITY_QUANTITY_MAX}`)
    }

    setBusy(true)
    try {
      const body = await send(
        {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), quantity: parsed, note: note.trim() }),
        },
        "Gagal menambah fasilitas",
      )

      // Foto diunggah setelah entri ada; kegagalannya tidak boleh membatalkan
      // fasilitas yang sudah tersimpan.
      if (photo && body?.id) {
        try {
          await uploadPhoto(body.id, photo)
        } catch (error) {
          router.refresh()
          toast.error(
            `Fasilitas tersimpan, tetapi foto gagal diunggah: ${
              error instanceof Error ? error.message : "coba lagi lewat menu Edit"
            }`,
          )
          setName("")
          setQuantity("")
          setNote("")
          setPhoto(null)
          return
        }
      }

      router.refresh()
      // Server memulihkan entri lama alih-alih membuat duplikat; katakan apa
      // adanya supaya admin tidak bingung mencari entri barunya.
      toast.success(
        body.reused ? `"${body.name}" sudah ada dan diaktifkan kembali` : "Fasilitas ditambahkan",
      )
      setName("")
      setQuantity("")
      setNote("")
      setPhoto(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambah fasilitas")
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (facility: FacilityRow, active: boolean) => {
    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: facility.id, active }) },
        "Gagal memperbarui fasilitas",
      )
      router.refresh()
      toast.success(active ? "Fasilitas ditampilkan" : "Fasilitas disembunyikan")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui fasilitas")
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (facility: FacilityRow) => {
    setEditTarget(facility)
    setEditName(facility.name)
    setEditQuantity(facility.quantity === null ? "" : String(facility.quantity))
    setEditNote(facility.note ?? "")
    setEditPhoto(null)
    setEditPhotoCleared(false)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    if (editName.trim().length < 2) return toast.error("Nama fasilitas wajib diisi")
    const parsed = parseQuantity(editQuantity)
    if (parsed === undefined) {
      return toast.error(`Jumlah harus bilangan bulat 0–${FACILITY_QUANTITY_MAX}`)
    }

    setBusy(true)
    try {
      await send(
        {
          method: "PATCH",
          body: JSON.stringify({
            id: editTarget.id,
            name: editName.trim(),
            quantity: parsed,
            note: editNote.trim(),
          }),
        },
        "Gagal memperbarui fasilitas",
      )

      if (editPhotoCleared && !editPhoto) await removePhoto(editTarget.id)
      if (editPhoto) await uploadPhoto(editTarget.id, editPhoto)

      router.refresh()
      toast.success(editPhoto ? "Foto berhasil diperbarui" : "Fasilitas berhasil diperbarui")
      setEditTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui fasilitas")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await send(
        { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) },
        "Gagal menghapus fasilitas",
      )
      router.refresh()
      toast.success("Fasilitas berhasil dihapus")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus fasilitas")
    } finally {
      setBusy(false)
    }
  }

  const editCurrentUrl =
    editTarget && !editPhotoCleared ? euksFacilityPhotoUrl(editTarget.id, editTarget.photoUpdatedAt) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fasilitas UKS</CardTitle>
        <CardDescription>
          Daftar informatif untuk Halaman Utama. Stok barang tetap dikelola di modul Sarpras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <EuksPhotoField
            shape="landscape"
            currentUrl={null}
            file={photo}
            onFileChange={setPhoto}
            disabled={busy}
            frameClassName="w-20"
          />

          <div className="grid flex-1 items-end gap-3 sm:grid-cols-[1fr_7rem_1fr_auto]">
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
        </div>

        {facilities.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Belum ada fasilitas yang terdaftar.
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {facilities.map((facility) => (
              <li key={facility.id} className="flex items-center gap-3 px-3 py-2">
                <EuksPhotoFrame
                  src={euksFacilityPhotoUrl(facility.id, facility.photoUpdatedAt)}
                  alt={`Foto ${facility.name}`}
                  shape="landscape"
                  className="w-14"
                />

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

                <Menu>
                  <MenuTrigger
                    render={<Button variant="ghost" size="icon" disabled={busy} />}
                    aria-label={`Aksi untuk ${facility.name}`}
                  >
                    <EllipsisVertical className="size-4" />
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onClick={() => openEdit(facility)}>
                      <Pencil /> Edit
                    </MenuItem>
                    {/* Pintasan ke dialog yang sama; foto memang diurus di sana. */}
                    <MenuItem onClick={() => openEdit(facility)}>
                      <ImagePlus /> {facility.photoUpdatedAt ? "Ganti Foto" : "Tambah Foto"}
                    </MenuItem>
                    <MenuItem variant="destructive" onClick={() => setDeleteTarget(facility)}>
                      <Trash2 /> Hapus
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setEditTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit fasilitas UKS</DialogTitle>
            <DialogDescription>
              Perubahan berlaku pada daftar fasilitas yang tampil di Halaman Utama E-UKS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <EuksPhotoField
              shape="landscape"
              currentUrl={editCurrentUrl}
              file={editPhoto}
              onFileChange={setEditPhoto}
              onRemoveCurrent={editCurrentUrl ? () => setEditPhotoCleared(true) : undefined}
              disabled={busy}
              frameClassName="w-28"
            />

            <div className="space-y-1.5">
              <Label htmlFor="euks-facility-edit-name">Nama</Label>
              <Input
                id="euks-facility-edit-name"
                value={editName}
                maxLength={FACILITY_NAME_MAX}
                placeholder="Tempat tidur periksa"
                onChange={(event) => setEditName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="euks-facility-edit-quantity">Jumlah</Label>
              <Input
                id="euks-facility-edit-quantity"
                value={editQuantity}
                inputMode="numeric"
                placeholder="opsional"
                onChange={(event) => setEditQuantity(event.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="euks-facility-edit-note">Keterangan</Label>
              <Input
                id="euks-facility-edit-note"
                value={editNote}
                maxLength={FACILITY_NOTE_MAX}
                placeholder="opsional"
                onChange={(event) => setEditNote(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button onClick={saveEdit} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus fasilitas?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Hapus fasilitas "${deleteTarget.name}"? Entri dan fotonya akan hilang dari daftar.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {busy ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

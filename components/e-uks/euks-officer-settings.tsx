"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EuksPhotoField, EuksPhotoFrame } from "@/components/e-uks/euks-photo-field"
import { OFFICER_NAME_MAX, OFFICER_ROLE_MAX, euksOfficerPhotoUrl } from "@/lib/euks-settings"

export type OfficerRow = {
  id: string
  name: string
  role: string
  active: boolean
  sortOrder: number
  userId: string | null
  /** Null berarti belum berfoto; baris lama sebelum fitur ini selalu null. */
  photoUpdatedAt: Date | string | null
  user: { name: string; active: boolean } | null
}

const MANUAL = "__manual__"

export function EuksOfficerSettings({
  officers,
  teachers,
}: {
  officers: OfficerRow[]
  teachers: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [selection, setSelection] = useState<string>(MANUAL)
  const [name, setName] = useState("")
  const [role, setRole] = useState("")
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [editTarget, setEditTarget] = useState<OfficerRow | null>(null)
  const [editSelection, setEditSelection] = useState<string>(MANUAL)
  const [editName, setEditName] = useState("")
  const [editRole, setEditRole] = useState("")
  const [editPhoto, setEditPhoto] = useState<File | null>(null)
  const [editPhotoCleared, setEditPhotoCleared] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<OfficerRow | null>(null)

  const isManual = selection === MANUAL
  const isEditManual = editSelection === MANUAL

  const send = async (init: RequestInit, failure: string) => {
    const response = await fetch("/api/e-uks/officers", {
      headers: { "Content-Type": "application/json" },
      ...init,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? failure)
    }
    return response.json().catch(() => ({}))
  }

  /** Unggah foto untuk satu pengurus; dipakai saat tambah maupun edit. */
  const uploadPhoto = async (officerId: string, file: File) => {
    const data = new FormData()
    data.set("photo", file)
    const response = await fetch(`/api/e-uks/officers/${officerId}/photo`, {
      method: "PUT",
      body: data,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? "Foto gagal disimpan")
    }
  }

  const removePhoto = async (officerId: string) => {
    const response = await fetch(`/api/e-uks/officers/${officerId}/photo`, { method: "DELETE" })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? "Foto gagal dihapus")
    }
  }

  const add = async () => {
    if (isManual && name.trim().length < 2) return toast.error("Nama pengurus wajib diisi")
    if (!isManual && selection === "") return toast.error("Pilih guru terlebih dahulu")
    if (role.trim().length < 2) return toast.error("Jabatan wajib diisi")

    setBusy(true)
    try {
      const created = await send(
        {
          method: "POST",
          body: JSON.stringify({
            userId: isManual ? null : selection,
            // Untuk guru, nama diambil server dari akunnya; kirim placeholder
            // yang memenuhi validasi panjang minimum.
            name: isManual ? name.trim() : (teachers.find((t) => t.id === selection)?.name ?? "-"),
            role: role.trim(),
          }),
        },
        "Gagal menambah pengurus",
      )

      // Foto diunggah setelah entri ada. Bila unggahan gagal, pengurusnya
      // tetap tersimpan tanpa foto — bukan record setengah jadi — dan pesan
      // galat mengatakan persis itu.
      if (photo && created?.id) {
        try {
          await uploadPhoto(created.id, photo)
        } catch (error) {
          router.refresh()
          toast.error(
            `Pengurus tersimpan, tetapi foto gagal diunggah: ${
              error instanceof Error ? error.message : "coba lagi lewat menu Edit"
            }`,
          )
          setName("")
          setRole("")
          setPhoto(null)
          setSelection(MANUAL)
          return
        }
      }

      router.refresh()
      toast.success("Pengurus berhasil ditambahkan")
      setName("")
      setRole("")
      setPhoto(null)
      setSelection(MANUAL)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambah pengurus")
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (officer: OfficerRow, active: boolean) => {
    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: officer.id, active }) },
        "Gagal memperbarui pengurus",
      )
      router.refresh()
      toast.success(active ? "Pengurus diaktifkan" : "Pengurus dinonaktifkan")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui pengurus")
    } finally {
      setBusy(false)
    }
  }

  const move = async (officer: OfficerRow, direction: "up" | "down") => {
    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: officer.id, move: direction }) },
        "Gagal mengubah urutan",
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah urutan")
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (officer: OfficerRow) => {
    setEditTarget(officer)
    setEditSelection(officer.userId ?? MANUAL)
    setEditName(officer.name)
    setEditRole(officer.role)
    setEditPhoto(null)
    setEditPhotoCleared(false)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    if (isEditManual && editName.trim().length < 2) return toast.error("Nama pengurus wajib diisi")
    if (editRole.trim().length < 2) return toast.error("Jabatan wajib diisi")

    setBusy(true)
    try {
      await send(
        {
          method: "PATCH",
          body: JSON.stringify({
            id: editTarget.id,
            // Mengubah tautan hanya menulis kolom milik EuksOfficer; akun guru
            // sendiri tidak pernah ikut berubah.
            userId: isEditManual ? null : editSelection,
            name: isEditManual
              ? editName.trim()
              : (teachers.find((t) => t.id === editSelection)?.name ?? editTarget.name),
            role: editRole.trim(),
          }),
        },
        "Gagal memperbarui pengurus",
      )

      if (editPhotoCleared && !editPhoto) await removePhoto(editTarget.id)
      if (editPhoto) await uploadPhoto(editTarget.id, editPhoto)

      router.refresh()
      toast.success(editPhoto ? "Foto berhasil diperbarui" : "Pengurus berhasil diperbarui")
      setEditTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui pengurus")
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
        "Gagal menghapus pengurus",
      )
      router.refresh()
      toast.success("Pengurus berhasil dihapus")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus pengurus")
    } finally {
      setBusy(false)
    }
  }

  const displayName = (officer: OfficerRow) => officer.user?.name ?? officer.name

  const editCurrentUrl =
    editTarget && !editPhotoCleared ? euksOfficerPhotoUrl(editTarget.id, editTarget.photoUpdatedAt) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pengurus UKS</CardTitle>
        <CardDescription>
          Pilih guru yang sudah punya akun, atau ketik manual untuk siswa dan pihak luar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <EuksPhotoField
  slotKey="euks.officer.photo"
            shape="portrait"
            currentUrl={null}
            file={photo}
            onFileChange={setPhoto}
            disabled={busy}
            frameClassName="w-16"
          />

          <div
            className={`grid flex-1 items-end gap-3 ${
              isManual ? "sm:grid-cols-[1fr_1fr_1fr_auto]" : "sm:grid-cols-[1fr_1fr_auto]"
            }`}
          >
            <div className="space-y-1.5">
              <Label htmlFor="euks-officer-person">Orang</Label>
              <Select value={selection} onValueChange={(value) => setSelection(String(value))}>
                <SelectTrigger id="euks-officer-person" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === MANUAL
                        ? "Ketik manual (siswa / pihak luar)"
                        : (teachers.find((t) => t.id === value)?.name ?? "Ketik manual (siswa / pihak luar)")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL}>Ketik manual (siswa / pihak luar)</SelectItem>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isManual ? (
              <div className="space-y-1.5">
                <Label htmlFor="euks-officer-name">Nama</Label>
                <Input
                  id="euks-officer-name"
                  value={name}
                  maxLength={OFFICER_NAME_MAX}
                  placeholder="Nama pengurus"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="euks-officer-role">Jabatan</Label>
              <Input
                id="euks-officer-role"
                value={role}
                maxLength={OFFICER_ROLE_MAX}
                placeholder="Pembina"
                onChange={(event) => setRole(event.target.value)}
              />
            </div>

            <Button onClick={add} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Tambah
            </Button>
          </div>
        </div>

        {officers.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Belum ada pengurus UKS yang terdaftar.
          </p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {officers.map((officer, index) => (
              <li key={officer.id} className="flex items-center gap-3 px-3 py-2">
                <EuksPhotoFrame
                  src={euksOfficerPhotoUrl(officer.id, officer.photoUpdatedAt)}
                  alt={`Foto ${displayName(officer)}`}
                  shape="portrait"
                  className="w-9"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {displayName(officer)}
                    {officer.userId ? null : (
                      <Badge variant="secondary" className="ml-2 align-middle">
                        Manual
                      </Badge>
                    )}
                    {officer.user && !officer.user.active ? (
                      <Badge variant="outline" className="ml-2 align-middle">
                        Akun nonaktif
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">{officer.role}</p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Naikkan urutan"
                  disabled={busy || index === 0}
                  onClick={() => move(officer, "up")}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Turunkan urutan"
                  disabled={busy || index === officers.length - 1}
                  onClick={() => move(officer, "down")}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Switch
                  checked={officer.active}
                  disabled={busy}
                  aria-label={`Aktifkan ${displayName(officer)}`}
                  onCheckedChange={(checked) => toggle(officer, Boolean(checked))}
                />

                <Menu>
                  <MenuTrigger
                    render={<Button variant="ghost" size="icon" disabled={busy} />}
                    aria-label={`Aksi untuk ${displayName(officer)}`}
                  >
                    <EllipsisVertical className="size-4" />
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onClick={() => openEdit(officer)}>
                      <Pencil /> Edit
                    </MenuItem>
                    <MenuItem variant="destructive" onClick={() => setDeleteTarget(officer)}>
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
            <DialogTitle>Edit pengurus UKS</DialogTitle>
            <DialogDescription>
              Perubahan di sini hanya berlaku pada daftar pengurus UKS; data akun guru tidak ikut
              berubah.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <EuksPhotoField
  slotKey="euks.officer.photo"
              shape="portrait"
              currentUrl={editCurrentUrl}
              file={editPhoto}
              onFileChange={setEditPhoto}
              onRemoveCurrent={editCurrentUrl ? () => setEditPhotoCleared(true) : undefined}
              disabled={busy}
              frameClassName="w-20"
            />

            <div className="space-y-1.5">
              <Label htmlFor="euks-officer-edit-person">Orang</Label>
              <Select value={editSelection} onValueChange={(value) => setEditSelection(String(value))}>
                <SelectTrigger id="euks-officer-edit-person" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === MANUAL
                        ? "Ketik manual (siswa / pihak luar)"
                        : (teachers.find((t) => t.id === value)?.name ?? "Ketik manual (siswa / pihak luar)")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL}>Ketik manual (siswa / pihak luar)</SelectItem>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isEditManual ? (
              <div className="space-y-1.5">
                <Label htmlFor="euks-officer-edit-name">Nama</Label>
                <Input
                  id="euks-officer-edit-name"
                  value={editName}
                  maxLength={OFFICER_NAME_MAX}
                  placeholder="Nama pengurus"
                  onChange={(event) => setEditName(event.target.value)}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="euks-officer-edit-role">Jabatan</Label>
              <Input
                id="euks-officer-edit-role"
                value={editRole}
                maxLength={OFFICER_ROLE_MAX}
                placeholder="Pembina"
                onChange={(event) => setEditRole(event.target.value)}
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
            <DialogTitle>Hapus pengurus UKS?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Hapus ${displayName(deleteTarget)} dari daftar Pengurus UKS? Akun guru yang tertaut tidak ikut terhapus.`
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

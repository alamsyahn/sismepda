"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
  ImagePlus,
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
import { HERO_CAPTION_MAX, euksHeroImageUrl } from "@/lib/euks-settings"

export type HeroImageRow = {
  id: string
  caption: string | null
  active: boolean
  sortOrder: number
  /** Null berarti entri sudah dibuat tetapi fotonya belum diunggah. */
  photoUpdatedAt: Date | string | null
}

/**
 * Pengelolaan foto hero Halaman Utama.
 *
 * Mengikuti pola pengurus dan fasilitas: tambah, edit, urutkan, aktif/nonaktif,
 * dan hapus. Urutan di sini menentukan urutan slide pada carousel, dan
 * menonaktifkan satu foto mengeluarkannya dari carousel tanpa menghapus byte-nya.
 */
export function EuksHeroImageSettings({ images }: { images: HeroImageRow[] }) {
  const router = useRouter()
  const [caption, setCaption] = useState("")
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [editTarget, setEditTarget] = useState<HeroImageRow | null>(null)
  const [editCaption, setEditCaption] = useState("")
  const [editPhoto, setEditPhoto] = useState<File | null>(null)
  const [editPhotoCleared, setEditPhotoCleared] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<HeroImageRow | null>(null)

  const send = async (init: RequestInit, failure: string) => {
    const response = await fetch("/api/e-uks/hero-images", {
      headers: { "Content-Type": "application/json" },
      ...init,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? failure)
    return body
  }

  const uploadPhoto = async (imageId: string, file: File) => {
    const data = new FormData()
    data.set("photo", file)
    const response = await fetch(`/api/e-uks/hero-images/${imageId}/photo`, {
      method: "PUT",
      body: data,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? "Foto gagal disimpan")
    }
  }

  const removePhoto = async (imageId: string) => {
    const response = await fetch(`/api/e-uks/hero-images/${imageId}/photo`, { method: "DELETE" })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? "Foto gagal dihapus")
    }
  }

  const add = async () => {
    // Foto wajib di sini, berbeda dari pengurus/fasilitas: entri hero tanpa
    // foto tidak punya guna sama sekali pada carousel.
    if (!photo) return toast.error("Pilih foto hero terlebih dahulu")

    setBusy(true)
    try {
      const body = await send(
        { method: "POST", body: JSON.stringify({ caption: caption.trim() }) },
        "Gagal menambah foto hero",
      )

      if (body?.id) {
        try {
          await uploadPhoto(body.id, photo)
        } catch (error) {
          // Entri sudah ada tapi fotonya gagal: buang entrinya kembali supaya
          // tidak meninggalkan slide kosong di carousel.
          await send({ method: "DELETE", body: JSON.stringify({ id: body.id }) }, "").catch(
            () => undefined,
          )
          router.refresh()
          throw error
        }
      }

      router.refresh()
      toast.success("Foto hero ditambahkan")
      setCaption("")
      setPhoto(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambah foto hero")
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (image: HeroImageRow, active: boolean) => {
    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: image.id, active }) },
        "Gagal memperbarui foto hero",
      )
      router.refresh()
      toast.success(active ? "Foto hero ditampilkan" : "Foto hero disembunyikan")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui foto hero")
    } finally {
      setBusy(false)
    }
  }

  const move = async (image: HeroImageRow, direction: "up" | "down") => {
    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: image.id, move: direction }) },
        "Gagal mengubah urutan",
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah urutan")
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (image: HeroImageRow) => {
    setEditTarget(image)
    setEditCaption(image.caption ?? "")
    setEditPhoto(null)
    setEditPhotoCleared(false)
  }

  const saveEdit = async () => {
    if (!editTarget) return

    setBusy(true)
    try {
      await send(
        {
          method: "PATCH",
          body: JSON.stringify({ id: editTarget.id, caption: editCaption.trim() }),
        },
        "Gagal memperbarui foto hero",
      )

      if (editPhotoCleared && !editPhoto) await removePhoto(editTarget.id)
      if (editPhoto) await uploadPhoto(editTarget.id, editPhoto)

      router.refresh()
      toast.success(editPhoto ? "Foto berhasil diperbarui" : "Keterangan berhasil diperbarui")
      setEditTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui foto hero")
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
        "Gagal menghapus foto hero",
      )
      router.refresh()
      toast.success("Foto hero berhasil dihapus")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus foto hero")
    } finally {
      setBusy(false)
    }
  }

  const editCurrentUrl =
    editTarget && !editPhotoCleared ? euksHeroImageUrl(editTarget.id, editTarget.photoUpdatedAt) : null

  const activeCount = images.filter((image) => image.active && image.photoUpdatedAt).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Foto Hero Halaman Utama</CardTitle>
        <CardDescription>
          Foto latar carousel di bagian paling atas Halaman Utama E-UKS. Urutan di sini menentukan
          urutan slide. Tanpa foto aktif, hero tetap tampil memakai latar bawaan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <EuksPhotoField
  slotKey="euks.hero.image"
            shape="wide"
            currentUrl={null}
            file={photo}
            onFileChange={setPhoto}
            disabled={busy}
            label="Foto (16:9)"
            frameClassName="w-32"
          />

          <div className="grid flex-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="euks-hero-caption">Keterangan</Label>
              <Input
                id="euks-hero-caption"
                value={caption}
                maxLength={HERO_CAPTION_MAX}
                placeholder="opsional — mis. Ruang UKS tampak depan"
                onChange={(event) => setCaption(event.target.value)}
              />
            </div>
            <Button onClick={add} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Tambah
            </Button>
          </div>
        </div>

        {images.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Belum ada foto hero. Halaman Utama menampilkan latar bawaan sampai foto pertama
            ditambahkan.
          </p>
        ) : (
          <>
            <ul className="divide-border divide-y rounded-md border">
              {images.map((image, index) => (
                <li key={image.id} className="flex items-center gap-3 px-3 py-2">
                  <EuksPhotoFrame
                    src={euksHeroImageUrl(image.id, image.photoUpdatedAt)}
                    alt={image.caption ? `Foto hero ${image.caption}` : "Foto hero UKS"}
                    shape="wide"
                    className="w-20"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {image.caption ?? `Foto ${index + 1}`}
                    </p>
                    {!image.photoUpdatedAt ? (
                      <p className="text-destructive text-xs">
                        Belum ada foto — slide ini dilewati
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || index === 0}
                      aria-label={`Pindahkan ${image.caption ?? `foto ${index + 1}`} ke atas`}
                      onClick={() => move(image, "up")}
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || index === images.length - 1}
                      aria-label={`Pindahkan ${image.caption ?? `foto ${index + 1}`} ke bawah`}
                      onClick={() => move(image, "down")}
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </div>

                  <Switch
                    checked={image.active}
                    disabled={busy}
                    aria-label={`Tampilkan ${image.caption ?? `foto ${index + 1}`}`}
                    onCheckedChange={(checked) => toggle(image, Boolean(checked))}
                  />

                  <Menu>
                    <MenuTrigger
                      render={<Button variant="ghost" size="icon" disabled={busy} />}
                      aria-label={`Aksi untuk ${image.caption ?? `foto ${index + 1}`}`}
                    >
                      <EllipsisVertical className="size-4" />
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onClick={() => openEdit(image)}>
                        <Pencil /> Edit keterangan
                      </MenuItem>
                      {/* Pintasan ke dialog yang sama; foto memang diurus di sana. */}
                      <MenuItem onClick={() => openEdit(image)}>
                        <ImagePlus /> Ganti Foto
                      </MenuItem>
                      <MenuItem variant="destructive" onClick={() => setDeleteTarget(image)}>
                        <Trash2 /> Hapus
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </li>
              ))}
            </ul>

            {/* Satu foto tetap tampil, hanya tidak berganti. Dikatakan apa
                adanya supaya admin tidak menyangka carousel-nya rusak. */}
            {activeCount === 1 ? (
              <p className="text-muted-foreground text-xs">
                Hanya satu foto aktif, sehingga hero tampil statis tanpa perpindahan slide.
              </p>
            ) : null}

            {/* Tidak ada batas jumlah — ini hanya pengingat, bukan larangan.
                Setiap slide berdurasi 6,5 detik, jadi foto ke-9 dan seterusnya
                praktis jarang terlihat pengunjung. */}
            {activeCount > 8 ? (
              <p className="text-muted-foreground text-xs">
                Ada {activeCount} foto aktif. Carousel dengan banyak foto membuat foto terakhir
                jarang sempat dilihat pengunjung.
              </p>
            ) : null}
          </>
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
            <DialogTitle>Edit foto hero</DialogTitle>
            <DialogDescription>
              Perubahan berlaku pada carousel di bagian atas Halaman Utama E-UKS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <EuksPhotoField
  slotKey="euks.hero.image"
              shape="wide"
              currentUrl={editCurrentUrl}
              file={editPhoto}
              onFileChange={setEditPhoto}
              onRemoveCurrent={editCurrentUrl ? () => setEditPhotoCleared(true) : undefined}
              disabled={busy}
              label="Foto (16:9)"
              frameClassName="w-40"
            />

            <div className="space-y-1.5">
              <Label htmlFor="euks-hero-edit-caption">Keterangan</Label>
              <Input
                id="euks-hero-edit-caption"
                value={editCaption}
                maxLength={HERO_CAPTION_MAX}
                placeholder="opsional — mis. Ruang UKS tampak depan"
                onChange={(event) => setEditCaption(event.target.value)}
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
            <DialogTitle>Hapus foto hero?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Hapus ${
                    deleteTarget.caption ? `"${deleteTarget.caption}"` : "foto ini"
                  } dari carousel? Foto akan hilang permanen.`
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

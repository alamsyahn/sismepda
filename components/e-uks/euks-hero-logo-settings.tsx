"use client"

import { useEffect, useState } from "react"
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
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { formatBytes } from "@/lib/upload-slots"
import { describeOversizeFile, useUploadPolicy } from "@/lib/use-upload-policy"

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
import {
  EUKS_LOGO_ACCEPT,
  EUKS_LOGO_FORMAT_LABEL,
  euksHeroLogoUrl,
} from "@/lib/euks-logo"

const NAME_MAX = 80

export type HeroLogoRow = {
  id: string
  name: string
  active: boolean
  sortOrder: number
  /** Null berarti entri sudah dibuat tetapi berkasnya belum diunggah. */
  logoUpdatedAt: Date | string | null
}

/**
 * Pratinjau logo.
 *
 * Berbeda dari `EuksPhotoField` yang dipakai foto pengurus/fasilitas/hero:
 * komponen itu mengecilkan gambar lewat canvas sebelum diunggah, dan canvas
 * akan merasterisasi SVG — tepat menghilangkan alasan orang memilih SVG untuk
 * logo. Karena itu berkas logo dikirim apa adanya, dan pratinjaunya memakai
 * kotak `object-contain` yang meniru tampilan logo di hero.
 */
function LogoPreview({
  file,
  currentUrl,
  alt,
  className = "h-14 w-24",
}: {
  file?: File | null
  currentUrl?: string | null
  alt: string
  className?: string
}) {
  const [localUrl, setLocalUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setLocalUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setLocalUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const src = localUrl ?? currentUrl ?? null

  return (
    <div
      className={`bg-muted/40 flex shrink-0 items-center justify-center rounded-md border p-1.5 ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- berkas dari route terautentikasi; SVG tidak punya dimensi intrinsik untuk next/image.
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      ) : (
        <ImagePlus className="text-muted-foreground size-5" aria-hidden />
      )}
    </div>
  )
}

/** Input berkas logo; menolak berkas kebesaran sebelum sempat diunggah. */
function LogoFileInput({
  id,
  onFileChange,
  disabled,
}: {
  id: string
  onFileChange: (file: File | null) => void
  disabled?: boolean
}) {
  const uploadPolicy = useUploadPolicy("euks.hero.logo")
  return (
    <Input
      id={id}
      type="file"
      accept={EUKS_LOGO_ACCEPT}
      disabled={disabled}
      onChange={(event) => {
        const picked = event.target.files?.[0] ?? null
        const oversize = picked ? describeOversizeFile(picked, uploadPolicy) : null
        if (oversize) {
          toast.error(oversize)
          event.target.value = ""
          onFileChange(null)
          return
        }
        onFileChange(picked)
      }}
    />
  )
}

/**
 * Pengelolaan logo hero Halaman Utama.
 *
 * Mengikuti pola seksi pengaturan lain: tambah, edit, urutkan, aktif/nonaktif,
 * hapus. Urutan di sini menentukan urutan logo dari kiri ke kanan pada hero.
 */
export function EuksHeroLogoSettings({ logos }: { logos: HeroLogoRow[] }) {
  const uploadPolicy = useUploadPolicy("euks.hero.logo")
  const router = useRouter()
  const [name, setName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [editTarget, setEditTarget] = useState<HeroLogoRow | null>(null)
  const [editName, setEditName] = useState("")
  const [editFile, setEditFile] = useState<File | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<HeroLogoRow | null>(null)

  const send = async (init: RequestInit, failure: string) => {
    const response = await fetch("/api/e-uks/hero-logos", {
      headers: { "Content-Type": "application/json" },
      ...init,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? failure)
    return body
  }

  const uploadFile = async (logoId: string, picked: File) => {
    const data = new FormData()
    data.set("logo", picked)
    const response = await fetch(`/api/e-uks/hero-logos/${logoId}/logo`, {
      method: "PUT",
      body: data,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? "Logo gagal disimpan")
    }
  }

  const add = async () => {
    const trimmed = name.trim()
    // Nama wajib karena dipakai sebagai teks alternatif logo di hero.
    if (!trimmed) return toast.error("Isi nama logo terlebih dahulu")
    // Berkas wajib: entri logo tanpa berkas tidak berguna di hero.
    if (!file) return toast.error("Pilih berkas logo terlebih dahulu")

    setBusy(true)
    try {
      const body = await send(
        { method: "POST", body: JSON.stringify({ name: trimmed }) },
        "Gagal menambah logo",
      )

      if (body?.id) {
        try {
          await uploadFile(body.id, file)
        } catch (error) {
          // Entri sudah ada tapi berkasnya gagal: buang entrinya kembali supaya
          // tidak meninggalkan baris tanpa logo.
          await send({ method: "DELETE", body: JSON.stringify({ id: body.id }) }, "").catch(
            () => undefined,
          )
          router.refresh()
          throw error
        }
      }

      router.refresh()
      toast.success("Logo ditambahkan")
      setName("")
      setFile(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambah logo")
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (logo: HeroLogoRow, active: boolean) => {
    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: logo.id, active }) },
        "Gagal memperbarui logo",
      )
      router.refresh()
      toast.success(active ? "Logo ditampilkan" : "Logo disembunyikan")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui logo")
    } finally {
      setBusy(false)
    }
  }

  const move = async (logo: HeroLogoRow, direction: "up" | "down") => {
    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: logo.id, move: direction }) },
        "Gagal mengubah urutan",
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah urutan")
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (logo: HeroLogoRow) => {
    setEditTarget(logo)
    setEditName(logo.name)
    setEditFile(null)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    const trimmed = editName.trim()
    if (!trimmed) return toast.error("Nama logo wajib diisi")

    setBusy(true)
    try {
      await send(
        { method: "PATCH", body: JSON.stringify({ id: editTarget.id, name: trimmed }) },
        "Gagal memperbarui logo",
      )
      if (editFile) await uploadFile(editTarget.id, editFile)

      router.refresh()
      toast.success(editFile ? "Logo berhasil diperbarui" : "Nama logo berhasil diperbarui")
      setEditTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui logo")
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
        "Gagal menghapus logo",
      )
      router.refresh()
      toast.success("Logo berhasil dihapus")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus logo")
    } finally {
      setBusy(false)
    }
  }

  const activeCount = logos.filter((logo) => logo.active && logo.logoUpdatedAt).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo Hero Halaman Utama</CardTitle>
        <CardDescription>
          Logo institusi yang tampil di pojok kiri atas hero Halaman Utama E-UKS. Urutan di sini
          menentukan urutan logo dari kiri ke kanan. Format yang didukung: {EUKS_LOGO_FORMAT_LABEL}
          , maksimal {formatBytes(uploadPolicy.maxBytes)} per berkas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <LogoPreview file={file} alt="Pratinjau logo baru" />

          <div className="grid flex-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="euks-logo-name">Nama institusi</Label>
                <Input
                  id="euks-logo-name"
                  value={name}
                  maxLength={NAME_MAX}
                  placeholder="mis. SMP Negeri 1 — dipakai sebagai teks alternatif"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="euks-logo-file">Berkas logo</Label>
                <LogoFileInput id="euks-logo-file" onFileChange={setFile} disabled={busy} />
              </div>
            </div>
            <Button onClick={add} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Tambah
            </Button>
          </div>
        </div>

        {logos.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Belum ada logo. Hero tampil tanpa logo sampai logo pertama ditambahkan.
          </p>
        ) : (
          <>
            <ul className="divide-border divide-y rounded-md border">
              {logos.map((logo, index) => (
                <li key={logo.id} className="flex items-center gap-3 px-3 py-2">
                  <LogoPreview
                    currentUrl={euksHeroLogoUrl(logo.id, logo.logoUpdatedAt)}
                    alt={`Logo ${logo.name}`}
                    className="h-11 w-16"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{logo.name}</p>
                    {!logo.logoUpdatedAt ? (
                      <p className="text-destructive text-xs">
                        Belum ada berkas — logo ini dilewati
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || index === 0}
                      aria-label={`Pindahkan ${logo.name} ke kiri`}
                      onClick={() => move(logo, "up")}
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || index === logos.length - 1}
                      aria-label={`Pindahkan ${logo.name} ke kanan`}
                      onClick={() => move(logo, "down")}
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </div>

                  <Switch
                    checked={logo.active}
                    disabled={busy}
                    aria-label={`Tampilkan ${logo.name}`}
                    onCheckedChange={(checked) => toggle(logo, Boolean(checked))}
                  />

                  <Menu>
                    <MenuTrigger
                      render={<Button variant="ghost" size="icon" disabled={busy} />}
                      aria-label={`Aksi untuk ${logo.name}`}
                    >
                      <EllipsisVertical className="size-4" />
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onClick={() => openEdit(logo)}>
                        <Pencil /> Edit nama
                      </MenuItem>
                      <MenuItem onClick={() => openEdit(logo)}>
                        <Upload /> Ganti berkas
                      </MenuItem>
                      <MenuItem variant="destructive" onClick={() => setDeleteTarget(logo)}>
                        <Trash2 /> Hapus
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </li>
              ))}
            </ul>

            {/* Bukan larangan, hanya pengingat: logo yang terlalu banyak akan
                membungkus ke baris berikutnya dan menekan judul hero. */}
            {activeCount > 4 ? (
              <p className="text-muted-foreground text-xs">
                Ada {activeCount} logo aktif. Di layar ponsel logo sebanyak ini akan membungkus ke
                beberapa baris dan mempersempit ruang judul hero.
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
            <DialogTitle>Edit logo</DialogTitle>
            <DialogDescription>
              Perubahan berlaku pada hero di bagian atas Halaman Utama E-UKS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <LogoPreview
                file={editFile}
                currentUrl={
                  editTarget ? euksHeroLogoUrl(editTarget.id, editTarget.logoUpdatedAt) : null
                }
                alt={editTarget ? `Logo ${editTarget.name}` : "Pratinjau logo"}
              />
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="euks-logo-edit-file">Ganti berkas</Label>
                <LogoFileInput
                  id="euks-logo-edit-file"
                  onFileChange={setEditFile}
                  disabled={busy}
                />
                <p className="text-muted-foreground text-xs">
                  {EUKS_LOGO_FORMAT_LABEL}, maksimal {formatBytes(uploadPolicy.maxBytes)}. Kosongkan bila tidak ingin mengganti.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="euks-logo-edit-name">Nama institusi</Label>
              <Input
                id="euks-logo-edit-name"
                value={editName}
                maxLength={NAME_MAX}
                placeholder="dipakai sebagai teks alternatif"
                onChange={(event) => setEditName(event.target.value)}
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
            <DialogTitle>Hapus logo?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Hapus "${deleteTarget.name}" dari hero? Berkas logo akan hilang permanen.`
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

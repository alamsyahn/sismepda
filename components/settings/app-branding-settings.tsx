"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { GraduationCap, ImageIcon, Loader2, RotateCcw, Upload } from "lucide-react"
import { toast } from "sonner"
import { describeOversizeFile, describeUploadPolicy, useUploadPolicy } from "@/lib/use-upload-policy"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  APP_LOGO_ACCEPT,
  DEFAULT_APP_LOGO_URL,
  MAX_APP_FULL_NAME_LENGTH,
  MAX_APP_NAME_LENGTH,
  DEFAULT_APP_NAME,
  DEFAULT_APP_FULL_NAME,
} from "@/lib/site-branding"

/**
 * Nama & subtitle ikut tombol "Simpan Perubahan" global halaman Pengaturan.
 * Logo memakai endpoint upload tersendiri (seperti favicon) karena berupa
 * binary multipart, sehingga aksinya langsung berlaku saat file dipilih.
 */
export function AppBrandingSettings({
  appName,
  appFullName,
  logoUrl,
  hasLogo,
  onAppNameChange,
  onAppFullNameChange,
  onLogoChange,
}: {
  appName: string
  appFullName: string
  logoUrl: string
  hasLogo: boolean
  onAppNameChange: (value: string) => void
  onAppFullNameChange: (value: string) => void
  onLogoChange: (next: { logoUrl: string; hasLogo: boolean }) => void
}) {
  const uploadPolicy = useUploadPolicy("branding.app.logo")
  const [busy, setBusy] = useState<"upload" | "reset" | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function uploadLogo(file: File | null) {
    if (!file) return
    const validType = ["image/png", "image/jpeg", "image/webp"].includes(file.type)
    if (!validType) { toast.error("Logo harus berformat PNG, JPG, atau WebP"); return }
    const oversize = describeOversizeFile(file, uploadPolicy)
    if (oversize) { toast.error(oversize); return }

    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    setBusy("upload")
    try {
      const formData = new FormData()
      formData.set("logo", file)
      const response = await fetch("/app-logo", { method: "PUT", body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Logo gagal disimpan")
      onLogoChange({ logoUrl: data.appLogoUrl, hasLogo: true })
      toast.success("Logo aplikasi berhasil diperbarui")
    } catch (error) {
      // Upload gagal: buang preview agar logo lama tetap terlihat utuh.
      setPreview(null)
      URL.revokeObjectURL(objectUrl)
      toast.error(error instanceof Error ? error.message : "Logo gagal disimpan")
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function resetLogo() {
    setBusy("reset")
    try {
      const response = await fetch("/app-logo", { method: "DELETE" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Logo gagal dikembalikan ke default")
      setPreview(null)
      onLogoChange({ logoUrl: DEFAULT_APP_LOGO_URL, hasLogo: false })
      toast.success("Logo kembali ke default")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logo gagal dikembalikan ke default")
    } finally {
      setBusy(null)
    }
  }

  const previewName = appName.trim() || DEFAULT_APP_NAME
  const previewFullName = appFullName.trim() || DEFAULT_APP_FULL_NAME
  const shownLogo = preview ?? (hasLogo ? logoUrl : null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding Aplikasi</CardTitle>
        <CardDescription>Atur nama, nama lengkap, dan logo yang tampil pada sidebar aplikasi.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="app-name">Nama aplikasi</Label>
            <Input id="app-name" value={appName} onChange={(event) => onAppNameChange(event.target.value)} maxLength={MAX_APP_NAME_LENGTH} className="bg-card" placeholder={DEFAULT_APP_NAME} />
            <p className="text-xs text-muted-foreground">Teks utama pada branding sidebar.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-full-name">Nama lengkap</Label>
            <Input id="app-full-name" value={appFullName} onChange={(event) => onAppFullNameChange(event.target.value)} maxLength={MAX_APP_FULL_NAME_LENGTH} className="bg-card" placeholder={DEFAULT_APP_FULL_NAME} />
            <p className="text-xs text-muted-foreground">Teks kecil di bawah nama aplikasi.</p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-[96px_1fr] sm:items-center">
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
            {shownLogo
              ? <Image src={shownLogo} alt="Logo aplikasi" width={80} height={80} unoptimized className="size-20 object-contain" />
              : <ImageIcon className="size-8 text-muted-foreground" />}
          </div>
          <div className="space-y-3">
            <div>
              <p className="font-medium">Logo aplikasi</p>
              <p className="text-xs text-muted-foreground">{describeUploadPolicy(uploadPolicy)} Disarankan berukuran persegi.</p>
            </div>
            <input ref={inputRef} type="file" accept={APP_LOGO_ACCEPT} className="sr-only" onChange={(event) => uploadLogo(event.target.files?.[0] ?? null)} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
                {busy === "upload" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {busy === "upload" ? "Mengunggah..." : "Pilih Logo"}
              </Button>
              {hasLogo ? (
                <Button type="button" variant="outline" onClick={resetLogo} disabled={busy !== null}>
                  {busy === "reset" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  Kembalikan ke Default
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <Separator />

        {/* Preview menyerupai branding sidebar, mengikuti nilai form saat ini. */}
        <div className="space-y-2">
          <Label>Preview sidebar</Label>
          <div className="w-fit min-w-64 rounded-xl border border-sidebar-border bg-sidebar px-5 py-4">
            <div className="flex items-center gap-3">
              {shownLogo ? (
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-card shadow-sm">
                  <Image src={shownLogo} alt="" width={40} height={40} unoptimized className="size-full object-contain p-0.5" />
                </span>
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <GraduationCap className="size-5" />
                </span>
              )}
              <div className="min-w-0 leading-tight">
                <p className="truncate text-base font-bold tracking-tight text-sidebar-foreground">{previewName}</p>
                <p className="truncate text-xs text-muted-foreground">{previewFullName}</p>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Nama dan nama lengkap tersimpan saat menekan Simpan Perubahan.</p>
        </div>
      </CardContent>
    </Card>
  )
}

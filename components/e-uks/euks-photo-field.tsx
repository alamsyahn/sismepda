"use client"

import { useEffect, useRef, useState } from "react"
import { ImageIcon, Loader2, Trash2, UserRound } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resizeImageFile } from "@/lib/image-resize"
import {
  EUKS_PHOTO_MAX_EDGE,
  MAX_EUKS_PHOTO_BYTES,
} from "@/lib/euks-settings"

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"]

export type EuksPhotoShape = "portrait" | "landscape"

const FRAME: Record<EuksPhotoShape, { ratio: string; hint: string; aspect: number }> = {
  // 9:16 potret — dipakai kartu pengurus; lihat euks-settings untuk rasionya.
  portrait: { ratio: "aspect-9/16", hint: "Rasio 9:16 (potret)", aspect: 9 / 16 },
  landscape: { ratio: "aspect-4/3", hint: "Rasio 4:3 (lanskap)", aspect: 4 / 3 },
}

/** Bingkai foto beserta placeholder; dipakai form maupun baris daftar. */
export function EuksPhotoFrame({
  src,
  alt,
  shape,
  className,
}: {
  src: string | null
  alt: string
  shape: EuksPhotoShape
  className?: string
}) {
  const Icon = shape === "portrait" ? UserRound : ImageIcon
  return (
    <div
      className={cn(
        // Persegi panjang, bukan lingkaran: foto ini dipakai sebagai potret
        // pengurus dan harus tampil utuh dalam orientasinya.
        "bg-muted text-muted-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-md border",
        FRAME[shape].ratio,
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- byte foto dilayani route terproteksi, bukan aset statis
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <Icon className="size-1/3 opacity-60" aria-hidden />
      )}
    </div>
  )
}

/**
 * Pemilih foto dengan pratinjau langsung.
 *
 * Berkas dikompres di browser ke rasio dan ukuran target sebelum diserahkan ke
 * pemanggil, sehingga foto 8 MB dari HP tidak pernah sampai ke database.
 * Komponen ini tidak mengunggah sendiri: pemanggil yang menentukan kapan file
 * dikirim (saat tambah, saat simpan edit, atau langsung), supaya unggahan yang
 * gagal tidak meninggalkan record setengah tersimpan.
 */
export function EuksPhotoField({
  shape,
  currentUrl,
  file,
  onFileChange,
  onRemoveCurrent,
  disabled,
  busy,
  label = "Foto",
  frameClassName,
}: {
  shape: EuksPhotoShape
  /** Foto yang sudah tersimpan, bila ada. */
  currentUrl: string | null
  /** Berkas yang sedang dipilih tetapi belum disimpan. */
  file: File | null
  onFileChange: (file: File | null) => void
  /** Hapus foto tersimpan; disembunyikan bila tidak tersedia. */
  onRemoveCurrent?: () => void
  disabled?: boolean
  busy?: boolean
  label?: string
  frameClassName?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Reset input file agar memilih berkas yang sama dua kali tetap memicu change.
  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = ""
  }, [file])

  async function choose(picked: File | null) {
    if (!picked) return
    if (!ACCEPTED.includes(picked.type)) {
      toast.error("Foto harus berformat JPG, PNG, atau WebP")
      return
    }
    setWorking(true)
    try {
      const prepared = await resizeImageFile(picked, {
        aspect: FRAME[shape].aspect,
        maxEdge: EUKS_PHOTO_MAX_EDGE,
      })
      if (prepared.size > MAX_EUKS_PHOTO_BYTES) {
        toast.error("Ukuran foto maksimal 2 MB")
        return
      }
      onFileChange(prepared)
    } finally {
      setWorking(false)
    }
  }

  const shown = preview ?? currentUrl
  const locked = Boolean(disabled) || busy || working

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-start gap-3">
        <EuksPhotoFrame
          src={shown}
          alt={label}
          shape={shape}
          className={frameClassName ?? (shape === "portrait" ? "w-20" : "w-28")}
        />
        <div className="space-y-1.5">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(event) => void choose(event.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={() => inputRef.current?.click()}
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : null}
              {shown ? "Ganti Foto" : "Pilih Foto"}
            </Button>
            {file ? (
              <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => onFileChange(null)}>
                Batalkan
              </Button>
            ) : currentUrl && onRemoveCurrent ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={locked}
                onClick={onRemoveCurrent}
              >
                <Trash2 className="size-4" /> Hapus Foto
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {FRAME[shape].hint} · JPG, PNG, WebP · maks 2 MB
          </p>
        </div>
      </div>
    </div>
  )
}

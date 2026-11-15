"use client"

import { useEffect, useRef, useState } from "react"
import { ImageIcon, Loader2, Trash2, UserRound } from "lucide-react"
import { toast } from "sonner"
import { describeOversizeFile, describeUploadPolicy, useUploadPolicy } from "@/lib/use-upload-policy"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resizeImageFile } from "@/lib/image-resize"
import { DEFAULT_PHOTO_FRAMING, panPhoto, photoFramingStyle, readPhotoFraming, type PhotoFraming } from "@/lib/euks-photo-framing"
import {
  EUKS_HERO_MAX_EDGE,
  EUKS_PHOTO_MAX_EDGE,
} from "@/lib/euks-settings"

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"]

export type EuksPhotoShape = "portrait" | "landscape" | "wide"

export async function updatePhotoFraming(path: string, version: Date | string | null, framing: PhotoFraming, previous: unknown) {
  const original = readPhotoFraming(previous)
  if (!version || (framing.x === original.x && framing.y === original.y && framing.zoom === original.zoom)) return
  const response = await fetch(path, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: new Date(version).toISOString(), framing }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? "Tampilan foto gagal disimpan")
  }
}

const FRAME: Record<EuksPhotoShape, { ratio: string; hint: string }> = {
  // 9:16 potret — dipakai kartu pengurus; lihat euks-settings untuk rasionya.
  portrait: { ratio: "aspect-9/16", hint: "Rasio 9:16 (potret)" },
  landscape: { ratio: "aspect-4/3", hint: "Rasio 4:3 (lanskap)" },
  // 16:9 — foto hero, dipasang sebagai latar selebar layar.
  wide: { ratio: "aspect-16/9", hint: "Pratinjau 16:9. Bentuk banner menyesuaikan layar." },
}

/** Bingkai foto beserta placeholder; dipakai form maupun baris daftar. */
export function EuksPhotoFrame({
  src,
  alt,
  shape,
  className,
  framing,
}: {
  src: string | null
  alt: string
  shape: EuksPhotoShape
  className?: string
  framing?: unknown
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
        <img src={src} alt={alt} draggable={false} className="size-full object-cover" style={photoFramingStyle(framing)} />
      ) : (
        <Icon className="size-1/3 opacity-60" aria-hidden />
      )}
    </div>
  )
}

/**
 * Pemilih foto dengan pratinjau langsung.
 *
 * Berkas diperkecil di browser tanpa memotong area foto sebelum diserahkan ke
 * pemanggil, sehingga foto 8 MB dari HP tidak pernah sampai ke database.
 * Komponen ini tidak mengunggah sendiri: pemanggil yang menentukan kapan file
 * dikirim (saat tambah, saat simpan edit, atau langsung), supaya unggahan yang
 * gagal tidak meninggalkan record setengah tersimpan.
 */
export function EuksPhotoField({
  slotKey,
  shape,
  currentUrl,
  file,
  onFileChange,
  onRemoveCurrent,
  disabled,
  busy,
  label = "Foto",
  frameClassName,
  framing,
  currentFraming,
  onFramingChange,
}: {
  /** Slot unggah yang mengatur batas ukuran field ini. */
  slotKey: string
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
  framing: PhotoFraming
  currentFraming?: unknown
  onFramingChange: (value: PhotoFraming) => void
}) {
  const uploadPolicy = useUploadPolicy(slotKey)
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const drag = useRef<{ x: number; y: number; framing: PhotoFraming } | null>(null)

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
        // Foto hero ditampilkan selebar layar, jadi butuh sisi lebih panjang
        // daripada thumbnail kartu.
        maxEdge: shape === "wide" ? EUKS_HERO_MAX_EDGE : EUKS_PHOTO_MAX_EDGE,
      })
      // Berlaku pada hasil resize, karena itulah byte yang dikirim.
      const oversize = describeOversizeFile(prepared, uploadPolicy)
      if (oversize) {
        toast.error(oversize)
        return
      }
      onFramingChange(DEFAULT_PHOTO_FRAMING)
      onFileChange(prepared)
      setAdjusting(true)
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
          framing={framing}
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
              <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => {
                onFramingChange(readPhotoFraming(currentFraming))
                onFileChange(null)
              }}>
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
            {shown ? <Button type="button" variant="outline" size="sm" disabled={locked}
              aria-expanded={adjusting} onClick={() => setAdjusting(value => !value)}>
              {adjusting ? "Tutup pengaturan tampilan" : "Atur tampilan foto"}
            </Button> : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {FRAME[shape].hint} · {describeUploadPolicy(uploadPolicy)}
          </p>
        </div>
      </div>
      {shown && adjusting ? (
        <fieldset disabled={locked} className="mt-3 space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Pratinjau tampilan foto</legend>
          <div
            className={cn("touch-none cursor-grab select-none active:cursor-grabbing", shape === "portrait" ? "w-36 max-w-full" : "w-full max-w-sm")}
            onPointerDown={event => {
              if (locked || !event.isPrimary || event.button !== 0) return
              drag.current = { x: event.clientX, y: event.clientY, framing }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={event => {
              if (!drag.current || locked || !event.isPrimary) return
              const img = event.currentTarget.querySelector("img")
              if (!img) return
              onFramingChange(panPhoto(drag.current.framing, { width: img.naturalWidth, height: img.naturalHeight },
                { width: img.clientWidth, height: img.clientHeight }, event.clientX - drag.current.x, event.clientY - drag.current.y))
            }}
            onLostPointerCapture={() => { drag.current = null }}
          >
            <EuksPhotoFrame src={shown} alt={label} shape={shape} framing={framing} />
          </div>
          <p className="text-muted-foreground text-xs">Geser foto di dalam bingkai atau pakai penggeser posisi.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["zoom", "Zoom", 1, 3, 0.05],
              ["x", "Posisi horizontal", 0, 100, 1],
              ["y", "Posisi vertikal", 0, 100, 1],
            ] as const).map(([key, name, min, max, step]) => (
              <label key={key} className="grid gap-1 text-sm">
                {name}
                <input type="range" className="w-full" min={min} max={max} step={step} value={framing[key]}
                  onChange={event => onFramingChange({ ...framing, [key]: Number(event.target.value) })} />
              </label>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onFramingChange(DEFAULT_PHOTO_FRAMING)}>
            Reset tampilan
          </Button>
        </fieldset>
      ) : null}
    </div>
  )
}

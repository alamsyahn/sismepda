"use client"

import { useEffect, useState } from "react"
import { History, ImagePlus, Loader2, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { SarprasStatusBadge } from "@/components/sarpras/sarpras-status-badge"
import type { SarprasItemRow } from "@/lib/server-sarpras"
import {
  availabilityLabel,
  sarprasPriorityLabels,
  sarprasStatusColors,
  sarprasStatusLabels,
} from "@/lib/sarpras"
import { MAX_SARPRAS_PHOTO_BYTES, sarprasPhotoUrl } from "@/lib/sarpras-constants"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"

type HistoryEntry = {
  id: string
  summary: string
  createdAt: string
  actor: { id: string; name: string } | null
}

type Props = {
  item: SarprasItemRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  capabilities: {
    historyRead: boolean
    photos: { read: boolean; create: boolean; delete: boolean }
    itemUpdate: boolean
    itemDelete: boolean
  }
  onEdit: (item: SarprasItemRow) => void
  onDelete: (item: SarprasItemRow) => void
  onPreviewPhoto: (photoId: string, title: string) => void
  onChanged: () => void
}

/** Read-only detail for viewers; editors also get Edit/Delete and photo upload. */
export function SarprasDetailSheet({
  item,
  open,
  onOpenChange,
  capabilities,
  onEdit,
  onDelete,
  onPreviewPhoto,
  onChanged,
}: Props) {
  const { dateFromInstant, formatTime } = useSchoolTimeZone()
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [uploading, setUploading] = useState(false)

  const itemId = item?.id ?? null

  useEffect(() => {
    if (!open || !itemId || !capabilities.historyRead) {
      setHistory(null)
      return
    }
    let cancelled = false
    setHistory(null)
    fetch(`/api/sarpras/history?itemId=${encodeURIComponent(itemId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setHistory(Array.isArray(data.history) ? data.history : [])
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [open, itemId, capabilities.historyRead])

  async function uploadPhoto(file: File) {
    if (!item) return
    if (file.size > MAX_SARPRAS_PHOTO_BYTES) {
      toast.error("Ukuran foto maksimal 2 MB")
      return
    }
    setUploading(true)
    try {
      const body = new FormData()
      body.append("itemId", item.id)
      body.append("photo", file)
      const response = await fetch("/api/sarpras/photos", { method: "POST", body })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Foto gagal diunggah")
      toast.success("Foto ditambahkan")
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Foto gagal diunggah")
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto(photoId: string) {
    try {
      const response = await fetch(`/api/sarpras/photos?id=${encodeURIComponent(photoId)}`, {
        method: "DELETE",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Foto gagal dihapus")
      toast.success("Foto dihapus")
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Foto gagal dihapus")
    }
  }

  const conditions = item
    ? ([
        { status: "GOOD" as const, value: item.goodQuantity },
        { status: "MODERATE" as const, value: item.moderateQuantity },
        { status: "REPAIR" as const, value: item.repairQuantity },
      ] satisfies Array<{ status: "GOOD" | "MODERATE" | "REPAIR"; value: number }>)
    : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {item ? (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8 text-lg">{item.itemTypeName}</SheetTitle>
              <SheetDescription>{item.locationPath}</SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <SarprasStatusBadge status={item.status} />
                {item.priority ? (
                  <Badge variant="outline">
                    Prioritas {sarprasPriorityLabels[item.priority]}
                  </Badge>
                ) : null}
                {item.surplus > 0 ? (
                  <Badge variant="secondary">Lebih {item.surplus} unit</Badge>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Metric label="Kebutuhan" value={String(item.targetQuantity)} />
                <Metric label="Tersedia" value={availabilityLabel(item)} />
                {item.shortage > 0 ? (
                  <Metric
                    label="Belum tersedia"
                    value={`${item.shortage} unit`}
                    tone="text-destructive"
                  />
                ) : null}
                <Metric
                  label="Pengadaan"
                  value={item.acquisitionDate ? formatSchoolDate(fromPrismaDate(item.acquisitionDate), { day: "numeric", month: "short", year: "numeric" }) : "—"}
                />
                <Metric label="Kode Inventaris" value={item.inventoryCode || "—"} />
              </div>

              {item.availableQuantity > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Distribusi Kondisi</p>
                  <ul className="space-y-1.5">
                    {conditions.map((condition) => (
                      <li key={condition.status} className="flex items-center gap-2.5">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: sarprasStatusColors[condition.status] }}
                          aria-hidden
                        />
                        <span className="flex-1 text-sm text-muted-foreground">
                          {sarprasStatusLabels[condition.status]}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {condition.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {item.description ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">Keterangan</p>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">Foto</p>
                  {capabilities.photos.create ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-primary">
                      {uploading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ImagePlus className="size-4" />
                      )}
                      Tambah
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={uploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ""
                          if (file) void uploadPhoto(file)
                        }}
                      />
                    </label>
                  ) : null}
                </div>

                {item.photos.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
                    Belum ada foto.
                  </p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2">
                    {item.photos.map((photo) => (
                      <li key={photo.id} className="group/photo relative">
                        <button
                          type="button"
                          className="block w-full cursor-pointer overflow-hidden rounded-lg border border-border/70"
                          onClick={() =>
                            onPreviewPhoto(photo.id, `${item.itemTypeName} — ${item.locationPath}`)
                          }
                          aria-label={photo.caption ?? `Lihat foto ${item.itemTypeName}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={sarprasPhotoUrl(photo.id)}
                            alt={photo.caption ?? `Foto ${item.itemTypeName}`}
                            className="aspect-square w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                        {capabilities.photos.delete ? (
                          <button
                            type="button"
                            onClick={() => void removePhoto(photo.id)}
                            aria-label="Hapus foto"
                            className="absolute top-1 right-1 cursor-pointer rounded-md bg-foreground/70 p-1 text-background opacity-0 transition-opacity group-hover/photo:opacity-100 focus-visible:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <History className="size-4 text-muted-foreground" />
                  Riwayat Perubahan
                </p>
                {history === null ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada perubahan tercatat.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {history.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-border pl-3">
                        <p className="text-sm text-foreground">{entry.summary}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatSchoolDate(dateFromInstant(new Date(entry.createdAt)), { day: "numeric", month: "short", year: "numeric" })}, {formatTime(new Date(entry.createdAt))}
                          {entry.actor ? ` · ${entry.actor.name}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {capabilities.itemUpdate || capabilities.itemDelete ? (
                <div className="flex gap-2">
                  {capabilities.itemUpdate ? <Button variant="outline" className="flex-1" onClick={() => onEdit(item)}>
                    <Pencil className="size-4" />
                    Edit
                  </Button> : null}
                  {capabilities.itemDelete ? <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => onDelete(item)}
                    aria-label="Hapus barang"
                  >
                    <Trash2 className="size-4" />
                  </Button> : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  )
}

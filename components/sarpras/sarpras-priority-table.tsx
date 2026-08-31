"use client"

import { useMemo, useState } from "react"
import { ImageOff, PackageSearch, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SarprasStatusBadge } from "@/components/sarpras/sarpras-status-badge"
import { cn } from "@/lib/utils"
import { tableRowNumber } from "@/lib/table-row-number"
import type { SarprasItemRow } from "@/lib/server-sarpras"
import { sarprasPhotoUrl } from "@/lib/sarpras-constants"
import {
  availabilityLabel,
  availabilityText,
  formatSarprasDate,
  sarprasPriorityLabels,
  sarprasStatusLabels,
  sarprasStatusOrder,
  type SarprasStatus,
} from "@/lib/sarpras"

type Props = {
  items: SarprasItemRow[]
  activeStatus: SarprasStatus
  onStatusChange: (status: SarprasStatus) => void
  onSelectItem: (item: SarprasItemRow) => void
  onPreviewPhoto: (photoId: string, title: string) => void
}

/**
 * "Prioritas Sarpras" — one tab per status so a headteacher can open the page
 * and immediately read what is missing or broken, without filtering anything.
 */
export function SarprasPriorityTable({
  items,
  activeStatus,
  onStatusChange,
  onSelectItem,
  onPreviewPhoto,
}: Props) {
  const [query, setQuery] = useState("")

  const counts = useMemo(() => {
    const result: Record<SarprasStatus, number> = { MISSING: 0, REPAIR: 0, MODERATE: 0, GOOD: 0 }
    for (const item of items) result[item.status] += 1
    return result
  }, [items])

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return items
      .filter((item) => item.status === activeStatus)
      .filter(
        (item) =>
          keyword.length === 0 ||
          item.itemTypeName.toLowerCase().includes(keyword) ||
          item.locationPath.toLowerCase().includes(keyword) ||
          (item.inventoryCode ?? "").toLowerCase().includes(keyword),
      )
      // Worst shortage first, then the largest repair backlog.
      .sort(
        (a, b) =>
          b.shortage - a.shortage ||
          b.repairQuantity - a.repairQuantity ||
          a.itemTypeName.localeCompare(b.itemTypeName, "id"),
      )
  }, [items, activeStatus, query])

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Prioritas Sarpras</h2>
        <p className="text-sm text-muted-foreground">
          Sarana yang paling membutuhkan perhatian tampil lebih dahulu.
        </p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="tablist"
          aria-label="Filter status sarpras"
          className="flex w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1 lg:w-auto"
        >
          {sarprasStatusOrder.map((status) => {
            const isActive = status === activeStatus
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onStatusChange(status)}
                className={cn(
                  "flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors lg:flex-none",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {sarprasStatusLabels[status]}{" "}
                <span className="tabular-nums">({counts[status]})</span>
              </button>
            )
          })}
        </div>

        <div className="relative w-full lg:max-w-xs">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari barang atau lokasi..."
            aria-label="Cari pada tabel prioritas"
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">No</TableHead>
                  <TableHead className="min-w-40">Nama Barang</TableHead>
                  <TableHead className="min-w-36">Lokasi</TableHead>
                  <TableHead className="min-w-28">Ketersediaan</TableHead>
                  <TableHead className="min-w-36">Kondisi</TableHead>
                  <TableHead className="min-w-24">Jumlah</TableHead>
                  <TableHead className="min-w-28">Pengadaan</TableHead>
                  <TableHead className="min-w-48">Keterangan</TableHead>
                  <TableHead className="w-20">Foto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-40">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <PackageSearch className="size-5" />
                        </span>
                        <p className="text-sm text-muted-foreground">
                          {query.trim().length > 0
                            ? "Tidak ada barang yang cocok dengan pencarian."
                            : `Tidak ada sarpras berstatus ${sarprasStatusLabels[activeStatus]}.`}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((item, index) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      tabIndex={0}
                      role="button"
                      aria-label={`Detail ${item.itemTypeName} di ${item.locationPath}`}
                      onClick={() => onSelectItem(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          onSelectItem(item)
                        }
                      }}
                    >
                      <TableCell className="text-muted-foreground tabular-nums">
                        {tableRowNumber(index)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{item.itemTypeName}</span>
                          {item.priority ? (
                            <Badge variant="outline" className="shrink-0 text-[11px]">
                              {sarprasPriorityLabels[item.priority]}
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="line-clamp-2">{item.locationPath}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {availabilityText(item)}
                      </TableCell>
                      <TableCell>
                        {item.availableQuantity > 0 ? (
                          <SarprasStatusBadge status={item.status} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-foreground">
                        {availabilityLabel(item)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {item.acquisitionDate ? formatSarprasDate(item.acquisitionDate) : "—"}
                      </TableCell>
                      <TableCell className="max-w-64">
                        {item.description ? (
                          <span className="line-clamp-2 text-muted-foreground" title={item.description}>
                            {item.description}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.photos.length === 0 ? (
                          <span
                            className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                            aria-label="Belum ada foto"
                          >
                            <ImageOff className="size-4" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="relative cursor-pointer overflow-hidden rounded-lg border border-border/70"
                            aria-label={`Lihat foto ${item.itemTypeName}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              onPreviewPhoto(
                                item.photos[0].id,
                                `${item.itemTypeName} — ${item.locationPath}`,
                              )
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={sarprasPhotoUrl(item.photos[0].id)}
                              alt={`Foto ${item.itemTypeName}`}
                              className="size-9 object-cover"
                              loading="lazy"
                            />
                            {item.photos.length > 1 ? (
                              <span className="absolute right-0 bottom-0 rounded-tl bg-foreground/75 px-1 text-[10px] font-medium text-background tabular-nums">
                                {item.photos.length}
                              </span>
                            ) : null}
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

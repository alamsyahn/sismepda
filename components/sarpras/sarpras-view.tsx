"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
import { SarprasSummaryCard } from "@/components/sarpras/sarpras-summary-card"
import { SarprasPriorityTable } from "@/components/sarpras/sarpras-priority-table"
import { SarprasLocationTree } from "@/components/sarpras/sarpras-location-tree"
import { SarprasDetailSheet } from "@/components/sarpras/sarpras-detail-sheet"
import {
  SarprasItemDialog,
  emptyItemDraft,
  type ItemDraft,
} from "@/components/sarpras/sarpras-item-dialog"
import {
  SarprasLocationDialog,
  emptyLocationDraft,
  type LocationDraft,
} from "@/components/sarpras/sarpras-location-dialog"
import { fromPrismaDate } from "@/lib/school-date"
import type { SarprasStatus } from "@/lib/sarpras"
import type { SarprasItemRow, SarprasLocationRow, SarprasOverview } from "@/lib/server-sarpras"
import { sarprasPhotoUrl } from "@/lib/sarpras-constants"

type Props = {
  overview: SarprasOverview
  canEdit: boolean
}

/** yyyy-mm-dd for the date input, from a Date the server sent. */
function dateInputValue(date: Date | null): string {
  if (!date) return ""
  return fromPrismaDate(date)
}

function toItemDraft(item: SarprasItemRow): ItemDraft {
  return {
    id: item.id,
    locationId: item.locationId,
    itemTypeId: item.itemTypeId,
    targetQuantity: String(item.targetQuantity),
    availableQuantity: String(item.availableQuantity),
    goodQuantity: String(item.goodQuantity),
    moderateQuantity: String(item.moderateQuantity),
    repairQuantity: String(item.repairQuantity),
    acquisitionDate: dateInputValue(item.acquisitionDate),
    inventoryCode: item.inventoryCode ?? "",
    description: item.description ?? "",
    priority: item.priority ?? "",
  }
}

/**
 * Client shell for the Sarpras page. Owns the cross-section state — the chart
 * and the priority tabs share one selected status — and every dialog.
 */
export function SarprasView({ overview, canEdit }: Props) {
  const router = useRouter()

  const [activeStatus, setActiveStatus] = useState<SarprasStatus>("MISSING")
  const [itemTypes, setItemTypes] = useState(overview.itemTypes)

  const [detailItem, setDetailItem] = useState<SarprasItemRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const [itemDialogOpen, setItemDialogOpen] = useState(false)
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft)

  const [locationDialogOpen, setLocationDialogOpen] = useState(false)
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(emptyLocationDraft)

  const [deleteItem, setDeleteItem] = useState<SarprasItemRow | null>(null)
  const [deleteLocation, setDeleteLocation] = useState<SarprasLocationRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [preview, setPreview] = useState<{ photoId: string; title: string } | null>(null)

  // The server component re-reads and re-renders; keeping the sheet's item in
  // sync means a photo upload or edit is reflected without closing it.
  const syncedDetailItem = detailItem
    ? overview.items.find((item) => item.id === detailItem.id) ?? null
    : null

  function openItemDetail(item: SarprasItemRow) {
    setDetailItem(item)
    setDetailOpen(true)
  }

  function openCreateItem(locationId: string) {
    setItemDraft(emptyItemDraft(locationId))
    setItemDialogOpen(true)
  }

  function openEditItem(item: SarprasItemRow) {
    setItemDraft(toItemDraft(item))
    setDetailOpen(false)
    setItemDialogOpen(true)
  }

  function openCreateLocation(parentId: string | null) {
    setLocationDraft(emptyLocationDraft(parentId))
    setLocationDialogOpen(true)
  }

  function openEditLocation(location: SarprasLocationRow) {
    setLocationDraft({
      id: location.id,
      name: location.name,
      parentId: location.parentId,
      sortOrder: String(location.sortOrder),
    })
    setLocationDialogOpen(true)
  }

  async function confirmDeleteItem() {
    if (!deleteItem) return
    setDeleting(true)
    try {
      const response = await fetch("/api/sarpras/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteItem.id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Barang gagal dihapus")
      toast.success("Barang dihapus")
      setDeleteItem(null)
      setDetailOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Barang gagal dihapus")
    } finally {
      setDeleting(false)
    }
  }

  async function confirmDeleteLocation() {
    if (!deleteLocation) return
    setDeleting(true)
    try {
      const response = await fetch("/api/sarpras/locations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteLocation.id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Lokasi gagal dihapus")
      toast.success("Lokasi dihapus")
      setDeleteLocation(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lokasi gagal dihapus")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <SarprasSummaryCard
        stats={overview.stats}
        activeStatus={activeStatus}
        onSelectStatus={setActiveStatus}
      />

      <SarprasPriorityTable
        items={overview.items}
        activeStatus={activeStatus}
        onStatusChange={setActiveStatus}
        onSelectItem={openItemDetail}
        onPreviewPhoto={(photoId, title) => setPreview({ photoId, title })}
      />

      <SarprasLocationTree
        locations={overview.locations}
        items={overview.items}
        canEdit={canEdit}
        onAddLocation={openCreateLocation}
        onEditLocation={openEditLocation}
        onDeleteLocation={setDeleteLocation}
        onAddItem={openCreateItem}
        onSelectItem={openItemDetail}
      />

      <SarprasDetailSheet
        item={syncedDetailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        canEdit={canEdit}
        onEdit={openEditItem}
        onDelete={setDeleteItem}
        onPreviewPhoto={(photoId, title) => setPreview({ photoId, title })}
        onChanged={() => router.refresh()}
      />

      {canEdit ? (
        <>
          <SarprasItemDialog
            open={itemDialogOpen}
            onOpenChange={setItemDialogOpen}
            draft={itemDraft}
            locations={overview.locations}
            itemTypes={itemTypes}
            onItemTypeCreated={(itemType) =>
              setItemTypes((current) =>
                current.some((type) => type.id === itemType.id) ? current : [...current, itemType],
              )
            }
            onSaved={() => router.refresh()}
          />

          <SarprasLocationDialog
            open={locationDialogOpen}
            onOpenChange={setLocationDialogOpen}
            draft={locationDraft}
            locations={overview.locations}
            onSaved={() => router.refresh()}
          />
        </>
      ) : null}

      <Dialog
        open={deleteItem !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteItem(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus barang?</DialogTitle>
            <DialogDescription>
              {deleteItem
                ? `"${deleteItem.itemTypeName}" di ${deleteItem.locationPath} akan dihapus beserta foto dan riwayat perubahannya. Tindakan ini tidak dapat dibatalkan.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={deleting} />}>Batal</DialogClose>
            <Button
              variant="outline"
              className="text-destructive"
              disabled={deleting}
              onClick={() => void confirmDeleteItem()}
            >
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteLocation !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteLocation(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus lokasi?</DialogTitle>
            <DialogDescription>
              {deleteLocation
                ? `Lokasi "${deleteLocation.name}" akan dihapus. Lokasi yang masih berisi sub-lokasi atau barang tidak dapat dihapus — pindahkan isinya terlebih dahulu.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={deleting} />}>Batal</DialogClose>
            <Button
              variant="outline"
              className="text-destructive"
              disabled={deleting}
              onClick={() => void confirmDeleteLocation()}
            >
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{preview?.title}</DialogTitle>
          </DialogHeader>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sarprasPhotoUrl(preview.photoId)}
              alt={preview.title}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

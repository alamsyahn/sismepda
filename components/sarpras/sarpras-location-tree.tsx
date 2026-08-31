"use client"

import { useMemo, useState } from "react"
import {
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { SarprasStatusBadge } from "@/components/sarpras/sarpras-status-badge"
import { cn } from "@/lib/utils"
import {
  availabilityLabel,
  buildLocationTree,
  itemCountLabel,
  type LocationNode,
} from "@/lib/sarpras"
import type { SarprasItemRow, SarprasLocationRow } from "@/lib/server-sarpras"

type Props = {
  locations: SarprasLocationRow[]
  items: SarprasItemRow[]
  canEdit: boolean
  onAddLocation: (parentId: string | null) => void
  onEditLocation: (location: SarprasLocationRow) => void
  onDeleteLocation: (location: SarprasLocationRow) => void
  onAddItem: (locationId: string) => void
  onSelectItem: (item: SarprasItemRow) => void
}

/**
 * "Data Sarana & Prasarana" — the management tree. Every node can hold both
 * sub-locations and items, and search flattens straight to matching items so a
 * user never has to know where something lives to find it.
 */
export function SarprasLocationTree({
  locations,
  items,
  canEdit,
  onAddLocation,
  onEditLocation,
  onDeleteLocation,
  onAddItem,
  onSelectItem,
}: Props) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const itemsByLocation = useMemo(() => {
    const map = new Map<string, SarprasItemRow[]>()
    for (const item of items) {
      const list = map.get(item.locationId)
      if (list) list.push(item)
      else map.set(item.locationId, [item])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.itemTypeName.localeCompare(b.itemTypeName, "id"))
    }
    return map
  }, [items])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of items) map.set(item.locationId, (map.get(item.locationId) ?? 0) + 1)
    return map
  }, [items])

  const tree = useMemo(() => buildLocationTree(locations, counts), [locations, counts])

  const keyword = query.trim().toLowerCase()

  // Search bypasses the tree entirely: a flat result list is far faster to scan
  // than a partially-expanded hierarchy.
  const searchResults = useMemo(() => {
    if (keyword.length === 0) return null
    return items.filter(
      (item) =>
        item.itemTypeName.toLowerCase().includes(keyword) ||
        item.locationPath.toLowerCase().includes(keyword) ||
        (item.inventoryCode ?? "").toLowerCase().includes(keyword),
    )
  }, [items, keyword])

  function toggle(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Data Sarana &amp; Prasarana
          </h2>
          <p className="text-sm text-muted-foreground">
            Telusuri per lokasi, atau cari langsung barang yang dibutuhkan.
          </p>
        </div>
        {canEdit ? (
          <Button variant="outline" className="shrink-0" onClick={() => onAddLocation(null)}>
            <FolderPlus className="size-4" />
            Tambah Lokasi
          </Button>
        ) : null}
      </div>

      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari barang atau lokasi..."
          aria-label="Cari barang atau lokasi"
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-2 sm:p-3">
          {searchResults !== null ? (
            searchResults.length === 0 ? (
              <EmptyState message={`Tidak ada hasil untuk "${query.trim()}".`} />
            ) : (
              <ul className="space-y-1">
                {searchResults.map((item) => (
                  <li key={item.id}>
                    <ItemRow item={item} onSelect={onSelectItem} showPath />
                  </li>
                ))}
              </ul>
            )
          ) : tree.length === 0 ? (
            <EmptyState
              message="Belum ada lokasi sarpras."
              action={
                canEdit ? (
                  <Button size="sm" variant="outline" onClick={() => onAddLocation(null)}>
                    <FolderPlus className="size-4" />
                    Tambah Lokasi
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="space-y-0.5">
              {tree.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  expanded={expanded}
                  onToggle={toggle}
                  itemsByLocation={itemsByLocation}
                  canEdit={canEdit}
                  onAddLocation={onAddLocation}
                  onEditLocation={onEditLocation}
                  onDeleteLocation={onDeleteLocation}
                  onAddItem={onAddItem}
                  onSelectItem={onSelectItem}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function TreeRow({
  node,
  expanded,
  onToggle,
  itemsByLocation,
  canEdit,
  onAddLocation,
  onEditLocation,
  onDeleteLocation,
  onAddItem,
  onSelectItem,
}: {
  node: LocationNode<SarprasLocationRow>
  expanded: Record<string, boolean>
  onToggle: (id: string) => void
  itemsByLocation: Map<string, SarprasItemRow[]>
  canEdit: boolean
  onAddLocation: (parentId: string | null) => void
  onEditLocation: (location: SarprasLocationRow) => void
  onDeleteLocation: (location: SarprasLocationRow) => void
  onAddItem: (locationId: string) => void
  onSelectItem: (item: SarprasItemRow) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isOpen = expanded[node.id] ?? false
  const ownItems = itemsByLocation.get(node.id) ?? []
  const hasContent = node.children.length > 0 || ownItems.length > 0

  return (
    <li>
      <div
        className="group/node flex min-h-11 items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-accent/40"
        style={{ paddingLeft: `${node.depth * 18}px` }}
      >
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left"
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
              !hasContent && "opacity-30",
            )}
            aria-hidden
          />
          <span className="truncate text-sm font-medium text-foreground">{node.name}</span>
          <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground tabular-nums">
            {itemCountLabel(node.totalItemCount)}
          </span>
        </button>

        {canEdit ? (
          <div className="relative shrink-0">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Kelola ${node.name}`}
              onClick={() => setMenuOpen((value) => !value)}
              className="opacity-0 transition-opacity group-hover/node:opacity-100 focus-visible:opacity-100 data-[open=true]:opacity-100"
              data-open={menuOpen}
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {menuOpen ? (
              <>
                {/* Click-away layer keeps the menu dismissible without a portal. */}
                <div
                  className="fixed inset-0 z-40"
                  aria-hidden
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
                  <MenuItem
                    icon={<Plus className="size-4" />}
                    label="Tambah Barang"
                    onClick={() => {
                      setMenuOpen(false)
                      onAddItem(node.id)
                    }}
                  />
                  <MenuItem
                    icon={<FolderPlus className="size-4" />}
                    label="Tambah Sub-lokasi"
                    onClick={() => {
                      setMenuOpen(false)
                      onAddLocation(node.id)
                    }}
                  />
                  <MenuItem
                    icon={<Pencil className="size-4" />}
                    label="Edit / Pindahkan"
                    onClick={() => {
                      setMenuOpen(false)
                      onEditLocation(node)
                    }}
                  />
                  <MenuItem
                    icon={<Trash2 className="size-4" />}
                    label="Hapus"
                    tone="text-destructive"
                    onClick={() => {
                      setMenuOpen(false)
                      onDeleteLocation(node)
                    }}
                  />
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {isOpen ? (
        <div style={{ paddingLeft: `${node.depth * 18 + 26}px` }}>
          {ownItems.length === 0 && node.children.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-2 py-3">
              <p className="text-sm text-muted-foreground">
                Belum ada data sarpras di lokasi ini.
              </p>
              {canEdit ? (
                <Button size="sm" variant="outline" onClick={() => onAddItem(node.id)}>
                  <Plus className="size-4" />
                  Tambah Barang
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {ownItems.map((item) => (
                <li key={item.id}>
                  <ItemRow item={item} onSelect={onSelectItem} />
                </li>
              ))}
            </ul>
          )}

          {node.children.length > 0 ? (
            <ul className="space-y-0.5">
              {node.children.map((child) => (
                <TreeRow
                  key={child.id}
                  node={child}
                  expanded={expanded}
                  onToggle={onToggle}
                  itemsByLocation={itemsByLocation}
                  canEdit={canEdit}
                  onAddLocation={onAddLocation}
                  onEditLocation={onEditLocation}
                  onDeleteLocation={onDeleteLocation}
                  onAddItem={onAddItem}
                  onSelectItem={onSelectItem}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function ItemRow({
  item,
  onSelect,
  showPath = false,
}: {
  item: SarprasItemRow
  onSelect: (item: SarprasItemRow) => void
  showPath?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/40"
    >
      <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{item.itemTypeName}</span>
        {showPath ? (
          <span className="block truncate text-xs text-muted-foreground">{item.locationPath}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {availabilityLabel(item)}
      </span>
      <SarprasStatusBadge status={item.status} className="shrink-0" />
    </button>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  tone?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
        tone,
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Package className="size-5" />
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, Paperclip, Pencil, Plus, Receipt } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BosEntryDialog, emptyDraft, type EntryDraft } from "@/components/bos/bos-entry-dialog"
import { tableRowNumber } from "@/lib/table-row-number"
import { formatRupiah, type BosCategoryOption } from "@/lib/bos"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"
import type { BosEntryRow } from "@/lib/server-bos"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"

type Props = {
  entries: BosEntryRow[]
  categories: BosCategoryOption[]
  canCreate: boolean
  canEdit: boolean
  canCreateCategories: boolean
}

function toDraft(entry: BosEntryRow): EntryDraft {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    description: entry.description,
    occurredAt: fromPrismaDate(entry.occurredAt),
    amount: entry.amount ? String(entry.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "",
    documents: entry.documents.map((doc) => ({ label: doc.label ?? "", url: doc.url })),
  }
}

export function BosEntryTable({ entries, categories, canCreate, canEdit, canCreateCategories }: Props) {
  const { today } = useSchoolTimeZone()
  const router = useRouter()
  const [options, setOptions] = useState(categories)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<EntryDraft>(() => emptyDraft(today()))
  const [documentsFor, setDocumentsFor] = useState<BosEntryRow | null>(null)

  const hasEntries = entries.length > 0
  const sorted = useMemo(() => entries, [entries])

  function openCreate() {
    setDraft(emptyDraft(today()))
    setFormOpen(true)
  }

  function openEdit(entry: BosEntryRow) {
    if (!canEdit) return
    setDraft(toDraft(entry))
    setFormOpen(true)
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Detail Penggunaan BOS</h2>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Klik baris untuk mengubah entry."
              : "Rincian seluruh realisasi dana BOS."}
          </p>
        </div>
        {canCreate ? (
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="size-4" />
            Tambah Entry
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">No</TableHead>
                  <TableHead className="min-w-40">Kategori</TableHead>
                  <TableHead className="min-w-64">Deskripsi Pembelian</TableHead>
                  <TableHead className="min-w-32">Tanggal</TableHead>
                  <TableHead className="min-w-36 text-right">Realisasi</TableHead>
                  <TableHead className="min-w-32">Dokumentasi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!hasEntries ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-40">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <Receipt className="size-5" />
                        </span>
                        <p className="text-sm text-muted-foreground">
                          Belum ada entry penggunaan dana BOS.
                        </p>
                        {canCreate ? (
                          <Button size="sm" variant="outline" onClick={openCreate}>
                            <Plus className="size-4" />
                            Tambah Entry
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((entry, index) => (
                    <TableRow
                      key={entry.id}
                      // Edit affordance appears on hover/focus instead of a permanent column.
                      className={canEdit ? "group/row cursor-pointer" : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      role={canEdit ? "button" : undefined}
                      aria-label={canEdit ? `Edit entry ${entry.description}` : undefined}
                      onClick={canEdit ? () => openEdit(entry) : undefined}
                      onKeyDown={
                        canEdit
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                openEdit(entry)
                              }
                            }
                          : undefined
                      }
                    >
                      <TableCell className="text-muted-foreground tabular-nums">
                        {tableRowNumber(index)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.categoryActive ? "secondary" : "outline"}>
                          {entry.categoryName}
                          {entry.categoryActive ? "" : " · nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-80">
                        <span className="flex items-center gap-1.5">
                          <span className="line-clamp-2 text-foreground">{entry.description}</span>
                          {canEdit ? (
                            <Pencil
                              className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                              aria-hidden
                            />
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatSchoolDate(fromPrismaDate(entry.occurredAt), { day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-foreground">
                        {formatRupiah(entry.amount)}
                      </TableCell>
                      <TableCell>
                        {entry.documents.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={(event) => {
                              event.stopPropagation()
                              setDocumentsFor(entry)
                            }}
                          >
                            <Paperclip className="size-3.5" />
                            {entry.documents.length} file
                          </Button>
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

      <BosEntryDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        draft={draft}
        categories={options}
        canCreateCategory={canCreateCategories}
        onCategoryCreated={(category) =>
          setOptions((current) =>
            current.some((item) => item.id === category.id) ? current : [...current, category],
          )
        }
        onSaved={() => router.refresh()}
      />

      <Dialog open={documentsFor !== null} onOpenChange={(open) => { if (!open) setDocumentsFor(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dokumentasi</DialogTitle>
            <DialogDescription className="line-clamp-2">
              {documentsFor?.description}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(documentsFor?.documents ?? []).map((doc, index) => (
              <li key={doc.id}>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{doc.label || `Dokumentasi ${index + 1}`}</span>
                  <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  )
}

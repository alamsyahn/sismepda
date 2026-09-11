"use client"

import { useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BosCategoryCombobox } from "@/components/bos/bos-category-combobox"
import type { SchoolDate } from "@/lib/school-date"
import { normalizeDocumentUrl, type BosCategoryOption } from "@/lib/bos"

export type EntryDraft = {
  id?: string
  categoryId: string
  description: string
  occurredAt: string
  amount: string
  documents: Array<{ label: string; url: string }>
}

export function emptyDraft(today: SchoolDate): EntryDraft {
  return {
    categoryId: "",
    description: "",
    occurredAt: today,
    amount: "",
    documents: [],
  }
}

function groupDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  if (!digits) return ""
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

type EntryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: EntryDraft
  categories: BosCategoryOption[]
  canCreateCategory: boolean
  onCategoryCreated: (category: BosCategoryOption) => void
  onSaved: () => void
}

/** Create/edit form for one BOS entry, including its documentation links. */
export function BosEntryDialog({
  open,
  onOpenChange,
  draft,
  categories,
  canCreateCategory,
  onCategoryCreated,
  onSaved,
}: EntryDialogProps) {
  const [form, setForm] = useState<EntryDraft>(draft)
  const [saving, setSaving] = useState(false)
  const editing = Boolean(form.id)

  // Re-seed the form whenever a different entry (or a fresh create) is opened.
  const [seed, setSeed] = useState(draft)
  if (seed !== draft) {
    setSeed(draft)
    setForm(draft)
  }

  async function createCategory(name: string): Promise<BosCategoryOption | null> {
    try {
      const response = await fetch("/api/bos/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Kategori gagal dibuat")
      const category: BosCategoryOption = { id: data.id, name: data.name, active: data.active }
      onCategoryCreated(category)
      toast.success(data.reused ? `Kategori "${category.name}" sudah ada dan dipilih` : `Kategori "${category.name}" dibuat`)
      return category
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kategori gagal dibuat")
      return null
    }
  }

  function updateDocument(index: number, patch: Partial<{ label: string; url: string }>) {
    setForm((current) => ({
      ...current,
      documents: current.documents.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)),
    }))
  }

  async function save() {
    if (!form.categoryId) return toast.error("Kategori wajib dipilih")
    if (form.description.trim().length < 3) return toast.error("Deskripsi pembelian wajib diisi")
    if (!form.occurredAt) return toast.error("Tanggal wajib diisi")
    const amount = Number(form.amount.replace(/\D/g, ""))
    if (!Number.isFinite(amount)) return toast.error("Realisasi tidak valid")

    const documents = form.documents
      .filter((doc) => doc.url.trim().length > 0)
      .map((doc) => ({ url: doc.url.trim(), label: doc.label.trim() }))
    const invalid = documents.find((doc) => normalizeDocumentUrl(doc.url) === null)
    if (invalid) return toast.error("Link dokumentasi harus berupa URL http/https")

    setSaving(true)
    try {
      const response = await fetch(
        editing ? `/api/bos/entries/${form.id}` : "/api/bos/entries",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: form.categoryId,
            description: form.description.trim(),
            occurredAt: form.occurredAt,
            amount,
            documents,
          }),
        },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Entry gagal disimpan")
      toast.success(editing ? "Entry BOS diperbarui" : "Entry BOS ditambahkan")
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Entry gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!saving) onOpenChange(value) }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Entry BOS" : "Tambah Entry BOS"}</DialogTitle>
          <DialogDescription>
            Catat kategori, deskripsi pembelian, tanggal, realisasi, dan dokumentasi pendukung.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bos-category">Kategori *</Label>
            <BosCategoryCombobox
              id="bos-category"
              value={form.categoryId}
              categories={categories}
              canCreate={canCreateCategory}
              onChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))}
              onCreate={createCategory}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bos-description">Deskripsi Pembelian *</Label>
            <textarea
              id="bos-description"
              maxLength={2000}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Contoh: Pembelian 20 unit kursi siswa ruang kelas VII A"
              className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bos-date">Tanggal *</Label>
              <Input
                id="bos-date"
                type="date"
                value={form.occurredAt}
                onChange={(event) => setForm((current) => ({ ...current, occurredAt: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bos-amount">Realisasi *</Label>
              <Input
                id="bos-amount"
                inputMode="numeric"
                placeholder="0"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: groupDigits(event.target.value) }))}
                className="text-right tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Dokumentasi</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    documents: [...current.documents, { label: "", url: "" }],
                  }))
                }
              >
                <Plus className="size-4" />
                Tambah link
              </Button>
            </div>

            {form.documents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
                Belum ada dokumentasi. Tambahkan link nota, foto, atau berkas pendukung.
              </p>
            ) : (
              <ul className="space-y-2">
                {form.documents.map((doc, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                      <Input
                        value={doc.label}
                        placeholder="Nama (opsional)"
                        aria-label={`Nama dokumentasi ${index + 1}`}
                        onChange={(event) => updateDocument(index, { label: event.target.value })}
                      />
                      <Input
                        value={doc.url}
                        placeholder="https://..."
                        aria-label={`Link dokumentasi ${index + 1}`}
                        onChange={(event) => updateDocument(index, { url: event.target.value })}
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Hapus dokumentasi ${index + 1}`}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          documents: current.documents.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

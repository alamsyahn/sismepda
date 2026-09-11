"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
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
import { EuksStudentCombobox } from "@/components/e-uks/euks-student-combobox"
import type { SchoolDate } from "@/lib/school-date"
import type { EuksStudentOption } from "@/lib/euks"

export type VisitDraft = {
  id?: string
  studentId: string
  occurredAt: string
  complaint: string
  treatment: string
  followUp: string
}

export function emptyVisitDraft(today: SchoolDate): VisitDraft {
  return {
    studentId: "",
    occurredAt: today,
    complaint: "",
    treatment: "",
    followUp: "",
  }
}

type VisitDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: VisitDraft
  students: EuksStudentOption[]
  onSaved: () => void
}

/** Create/edit form for one UKS visit record. */
export function EuksVisitDialog({
  open,
  onOpenChange,
  draft,
  students,
  onSaved,
}: VisitDialogProps) {
  const [form, setForm] = useState<VisitDraft>(draft)
  const [saving, setSaving] = useState(false)
  const editing = Boolean(form.id)

  // Re-seed the form whenever a different visit (or a fresh create) is opened.
  const [seed, setSeed] = useState(draft)
  if (seed !== draft) {
    setSeed(draft)
    setForm(draft)
  }

  async function save() {
    if (!form.studentId) return toast.error("Siswa wajib dipilih")
    if (!form.occurredAt) return toast.error("Tanggal wajib diisi")
    if (form.complaint.trim().length < 2) return toast.error("Keluhan wajib diisi")
    if (form.treatment.trim().length < 2) return toast.error("Tindakan wajib diisi")

    setSaving(true)
    try {
      const response = await fetch(
        editing ? `/api/e-uks/visits/${form.id}` : "/api/e-uks/visits",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: form.studentId,
            occurredAt: form.occurredAt,
            complaint: form.complaint.trim(),
            treatment: form.treatment.trim(),
            followUp: form.followUp.trim(),
          }),
        },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Kunjungan gagal disimpan")
      toast.success(editing ? "Kunjungan UKS diperbarui" : "Kunjungan UKS dicatat")
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunjungan gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!saving) onOpenChange(value) }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Kunjungan UKS" : "Input Kunjungan UKS"}</DialogTitle>
          <DialogDescription>
            Catat siswa, tanggal, keluhan, tindakan yang diberikan, dan tindak lanjut.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="euks-student">Nama Siswa *</Label>
            <EuksStudentCombobox
              id="euks-student"
              value={form.studentId}
              students={students}
              onChange={(studentId) => setForm((current) => ({ ...current, studentId }))}
            />
            <p className="text-xs text-muted-foreground">
              Kelas mengikuti data siswa SISMEPDA.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="euks-date">Tanggal *</Label>
            <Input
              id="euks-date"
              type="date"
              value={form.occurredAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, occurredAt: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="euks-complaint">Keluhan *</Label>
            <Input
              id="euks-complaint"
              value={form.complaint}
              placeholder="Misal: Pusing"
              onChange={(event) =>
                setForm((current) => ({ ...current, complaint: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="euks-treatment">Tindakan yang Diberikan *</Label>
            <Input
              id="euks-treatment"
              value={form.treatment}
              placeholder="Misal: Istirahat di UKS"
              onChange={(event) =>
                setForm((current) => ({ ...current, treatment: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="euks-follow-up">Tindak Lanjut</Label>
            <Input
              id="euks-follow-up"
              value={form.followUp}
              placeholder="Opsional"
              onChange={(event) =>
                setForm((current) => ({ ...current, followUp: event.target.value }))
              }
            />
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

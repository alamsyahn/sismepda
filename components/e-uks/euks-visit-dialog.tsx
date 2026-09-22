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
  /** Label keluhan baku dari Pengaturan; kosong berarti isian bebas saja. */
  complaintOptions?: string[]
  /**
   * Apakah pengguna ini boleh mengirim notifikasi ke wali kelas.
   *
   * Tombol primer disembunyikan bila tidak, sehingga "Simpan Saja" menjadi
   * satu-satunya aksi simpan — bukan tombol yang terlihat lalu ditolak server.
   */
  canNotify?: boolean
  onSaved: () => void
}

/** Create/edit form for one UKS visit record. */
export function EuksVisitDialog({
  open,
  onOpenChange,
  draft,
  students,
  complaintOptions = [],
  canNotify = false,
  onSaved,
}: VisitDialogProps) {
  const [form, setForm] = useState<VisitDraft>(draft)
  // Menyimpan aksi yang sedang berjalan, bukan sekadar boolean: spinner harus
  // muncul di tombol yang benar-benar ditekan.
  const [saving, setSaving] = useState<null | "SAVE" | "NOTIFY">(null)
  const busy = saving !== null
  const editing = Boolean(form.id)

  // Re-seed the form whenever a different visit (or a fresh create) is opened.
  const [seed, setSeed] = useState(draft)
  if (seed !== draft) {
    setSeed(draft)
    setForm(draft)
  }

  /**
   * Simpan kunjungan; `notify` menentukan apakah wali kelas ikut dikabari.
   *
   * SATU PERMINTAAN, BUKAN DUA. Simpan-lalu-kirim sebagai dua panggilan akan
   * menghasilkan keadaan di mana kunjungan tersimpan tetapi petugas melihat
   * pesan kegagalan yang tidak menyebutkan bahwa datanya sudah aman.
   */
  async function save(notify: boolean) {
    if (!form.studentId) return toast.error("Siswa wajib dipilih")
    if (!form.occurredAt) return toast.error("Tanggal wajib diisi")
    if (form.complaint.trim().length < 2) return toast.error("Keluhan wajib diisi")
    if (form.treatment.trim().length < 2) return toast.error("Tindakan wajib diisi")

    setSaving(notify ? "NOTIFY" : "SAVE")
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
            // Hanya jalur buat-baru yang menerima flag ini; PATCH tidak pernah
            // mengirim pesan sebagai efek samping penyuntingan.
            ...(editing || !notify ? {} : { notify: true }),
          }),
        },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Kunjungan gagal disimpan")

      toast.success(editing ? "Kunjungan UKS diperbarui" : "Kunjungan UKS dicatat")

      // Hasil notifikasi dilaporkan TERPISAH dari hasil simpan: kunjungan yang
      // tersimpan tetap tersimpan walaupun pesannya gagal terkirim, dan petugas
      // harus tahu persis bagian mana yang gagal.
      if (notify && !editing) {
        const notification = data.notification as
          | { status: "SENT" | "FAILED" | "SKIPPED"; message: string }
          | null
        if (notification?.status === "SENT") toast.success(notification.message)
        else if (notification) toast.error(notification.message)
      }

      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunjungan gagal disimpan")
    } finally {
      setSaving(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value) }}>
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
            {/* datalist: menyarankan ejaan baku tanpa menutup isian bebas.
                Keluhan di luar daftar tetap boleh diketik. */}
            <Input
              id="euks-complaint"
              value={form.complaint}
              placeholder="Misal: Pusing"
              list={complaintOptions.length > 0 ? "euks-complaint-options" : undefined}
              autoComplete="off"
              onChange={(event) =>
                setForm((current) => ({ ...current, complaint: event.target.value }))
              }
            />
            {complaintOptions.length > 0 ? (
              <datalist id="euks-complaint-options">
                {complaintOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            ) : null}
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
              placeholder="Misal: Dirujuk ke Puskesmas"
              onChange={(event) =>
                setForm((current) => ({ ...current, followUp: event.target.value }))
              }
            />
          </div>
        </div>

        {/* Urutan kiri→kanan: Batal (netral) · Simpan Saja (sekunder) ·
            Simpan & Kirim Notifikasi (aksi utama). Aksi utama berada paling
            kanan karena itulah yang diharapkan dilakukan petugas UKS setelah
            mencatat kunjungan.

            `flex-col` pada layar sempit membuat ketiga tombol menumpuk penuh
            selebar dialog, bukan berdesakan lalu terpotong. Tidak ada kelas
            global yang diubah: seluruh gaya berasal dari varian Button yang
            sudah ada. */}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <DialogClose
            render={<Button variant="outline" disabled={busy} className="w-full sm:w-auto" />}
          >
            Batal
          </DialogClose>
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => void save(false)}
            disabled={busy}
          >
            {saving === "SAVE" ? <Loader2 className="size-4 animate-spin" /> : null}
            Simpan Saja
          </Button>
          {/* Notifikasi hanya bermakna untuk kunjungan BARU. Pada mode edit,
              mengirim pesan sebagai efek samping penyuntingan akan mengejutkan
              wali kelas dengan pesan kedua atas kunjungan lama. */}
          {canNotify && !editing ? (
            <Button
              className="w-full sm:w-auto"
              onClick={() => void save(true)}
              disabled={busy}
            >
              {saving === "NOTIFY" ? <Loader2 className="size-4 animate-spin" /> : null}
              Simpan &amp; Kirim Notifikasi
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

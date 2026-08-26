"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TeacherCombobox } from "@/components/wali-kelas/teacher-combobox"
import type { Teacher, WaliKelasClass } from "@/lib/wali-kelas"
import { toast } from "sonner"
import { ExportButton } from "@/components/export/export-button"

type Assignments = Record<string, string> // classId -> teacherId

function StatusBadge({ assigned }: { assigned: boolean }) {
  return assigned ? (
    <Badge className="border-transparent bg-[var(--chart-1)]/12 text-[var(--chart-1)]">
      Sudah dipilih
    </Badge>
  ) : (
    <Badge variant="secondary" className="text-muted-foreground">
      Belum ditentukan
    </Badge>
  )
}

export function WaliKelasManager() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [waliKelasClasses, setWaliKelasClasses] = useState<WaliKelasClass[]>([])
  const [assignments, setAssignments] = useState<Assignments>({})
  const [savedSnapshot, setSavedSnapshot] = useState<Assignments>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/admin/homerooms").then((r) => r.json()).then((data) => {
      setTeachers(data.teachers.map((t: { id: string; name: string; nip: string | null }) => ({ id: t.id, prefix: "", nama: t.name, nip: t.nip ?? "-" })))
      setWaliKelasClasses(data.classes.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))
      const current = Object.fromEntries(data.classes.filter((c: { homeroomUserId: string | null }) => c.homeroomUserId).map((c: { id: string; homeroomUserId: string }) => [c.id, c.homeroomUserId]))
      setAssignments(current); setSavedSnapshot(current)
    }).catch(() => toast.error("Gagal memuat data wali kelas"))
  }, [])

  const total = waliKelasClasses.length
  const assignedCount = Object.values(assignments).filter(Boolean).length
  const unassignedCount = total - assignedCount

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(assignments), ...Object.keys(savedSnapshot)])
    for (const k of keys) {
      if ((assignments[k] ?? "") !== (savedSnapshot[k] ?? "")) return true
    }
    return false
  }, [assignments, savedSnapshot])

  // Peta guru -> kelas lain tempat ia sudah menjadi wali (untuk menonaktifkan opsi).
  function assignedElsewhereFor(classId: string): Record<string, string> {
    const map: Record<string, string> = {}
    for (const [cid, tid] of Object.entries(assignments)) {
      if (!tid || cid === classId) continue
      const cls = waliKelasClasses.find((c) => c.id === cid)
      if (cls) map[tid] = cls.name
    }
    return map
  }

  function selectTeacher(classId: string, teacherId: string) {
    setAssignments((prev) => ({ ...prev, [classId]: teacherId }))
  }

  function clearTeacher(classId: string) {
    setAssignments((prev) => {
      const next = { ...prev }
      delete next[classId]
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    const response = await fetch("/api/admin/homerooms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(waliKelasClasses.map((c) => [c.id, assignments[c.id] ?? null]))) })
    if (!response.ok) { setSaving(false); toast.error("Gagal menyimpan wali kelas"); return }
    setSavedSnapshot(assignments)
    setSaving(false)
    setConfirmOpen(false)
    setSuccessOpen(true)
    toast.success("Data wali kelas berhasil disimpan")
  }

  const SaveButton = ({ block }: { block?: boolean }) => (
    <Button
      onClick={() => setConfirmOpen(true)}
      disabled={!dirty}
      className={block ? "w-full sm:w-auto" : undefined}
    >
      <Save className="size-4" />
      Simpan Data Wali Kelas
    </Button>
  )

  return (
    <div className="space-y-4">
      {/* Ringkasan */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border-border/60 shadow-sm">
          <CardContent className="flex items-center justify-between gap-2 py-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Kelas</p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">{total}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardContent className="flex items-center justify-between gap-2 py-4">
            <div>
              <p className="text-sm text-muted-foreground">Sudah Ada Wali Kelas</p>
              <p className="text-2xl font-semibold text-[var(--chart-1)] tabular-nums">
                {assignedCount}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardContent className="flex items-center justify-between gap-2 py-4">
            <div>
              <p className="text-sm text-muted-foreground">Belum Ditentukan</p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {unassignedCount}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bar aksi atas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--chart-4)]">
            <AlertTriangle className="size-4" />
            Ada perubahan yang belum disimpan
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Semua perubahan tersimpan</span>
        )}
        <div className="flex flex-wrap gap-2"><ExportButton type="homerooms" /><SaveButton /></div>
      </div>

      {/* Tabel (desktop) */}
      <Card className="hidden border-border/60 shadow-sm md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Kelas</TableHead>
                <TableHead>Wali Kelas</TableHead>
                <TableHead className="w-40">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waliKelasClasses.map((cls) => {
                const teacherId = assignments[cls.id] ?? null
                return (
                  <TableRow key={cls.id}>
                    <TableCell className="align-top">
                      <span className="inline-flex items-center font-semibold text-foreground">
                        {cls.name}
                      </span>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="max-w-md">
                        <TeacherCombobox
                          value={teacherId}
                          teachers={teachers}
                          assignedElsewhere={assignedElsewhereFor(cls.id)}
                          onSelect={(tid) => selectTeacher(cls.id, tid)}
                          onClear={() => clearTeacher(cls.id)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge assigned={Boolean(teacherId)} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Kartu (mobile) */}
      <div className="space-y-3 md:hidden">
        {waliKelasClasses.map((cls) => {
          const teacherId = assignments[cls.id] ?? null
          return (
            <Card key={cls.id} className="border-border/60 shadow-sm">
              <CardContent className="space-y-3 py-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{cls.name}</span>
                  <StatusBadge assigned={Boolean(teacherId)} />
                </div>
                <TeacherCombobox
                  value={teacherId}
                  teachers={teachers}
                  assignedElsewhere={assignedElsewhereFor(cls.id)}
                  onSelect={(tid) => selectTeacher(cls.id, tid)}
                  onClear={() => clearTeacher(cls.id)}
                />
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Bar aksi bawah */}
      <div className="flex justify-end">
        <SaveButton block />
      </div>

      {/* Dialog konfirmasi */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !saving && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Simpan data wali kelas?</DialogTitle>
            <DialogDescription>
              Pastikan guru wali kelas pada setiap kelas sudah sesuai.
            </DialogDescription>
          </DialogHeader>

          {unassignedCount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--chart-4)]/30 bg-[var(--chart-4)]/10 p-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--chart-4)]" />
              <p>
                Masih ada {unassignedCount} kelas yang belum memiliki wali kelas. Data tetap
                dapat disimpan.
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" disabled={saving}>
                  Batal
                </Button>
              }
            />
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                "Ya, Simpan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal sukses */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-[var(--chart-1)]/12">
              <CheckCircle2 className="size-6 text-[var(--chart-1)]" />
            </div>
            <DialogTitle>Data wali kelas berhasil disimpan</DialogTitle>
            <DialogDescription>
              Penugasan wali kelas telah berhasil diperbarui.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setSuccessOpen(false)} className="w-full sm:w-auto">
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

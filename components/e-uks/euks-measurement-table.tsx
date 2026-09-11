"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatBmi, type BmiPoint } from "@/lib/euks"

type Props = {
  studentId: string
  points: BmiPoint[]
  canEdit: boolean
}

/** History of measurements plus the form that appends a new one. */
export function EuksMeasurementTable({ studentId, points, canEdit }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [measuredAt, setMeasuredAt] = useState("")
  const [heightCm, setHeightCm] = useState("")
  const [weightKg, setWeightKg] = useState("")
  const [note, setNote] = useState("")

  const reset = () => {
    setMeasuredAt("")
    setHeightCm("")
    setWeightKg("")
    setNote("")
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await fetch("/api/e-uks/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          measuredAt,
          heightCm: Number(heightCm),
          weightKg: Number(weightKg),
          note: note.trim() || undefined,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Pengukuran gagal disimpan")
      toast.success("Pengukuran tersimpan")
      setOpen(false)
      reset()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pengukuran gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (point: BmiPoint) => {
    if (!window.confirm(`Hapus pengukuran tanggal ${point.measuredAt}?`)) return
    try {
      const response = await fetch(`/api/e-uks/measurements/${point.id}`, { method: "DELETE" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Pengukuran gagal dihapus")
      toast.success("Pengukuran dihapus")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pengukuran gagal dihapus")
    }
  }

  const ordered = [...points].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="size-4" />
              Tambah Pengukuran
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader>
                  <DialogTitle>Tambah Pengukuran</DialogTitle>
                  <DialogDescription>
                    IMT dihitung otomatis dari tinggi dan berat badan.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="measuredAt">Tanggal Pengukuran</Label>
                    <Input
                      id="measuredAt"
                      type="date"
                      required
                      value={measuredAt}
                      onChange={(event) => setMeasuredAt(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="heightCm">Tinggi Badan (cm)</Label>
                    <Input
                      id="heightCm"
                      type="number"
                      step="0.1"
                      min="1"
                      max="250"
                      required
                      value={heightCm}
                      onChange={(event) => setHeightCm(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="weightKg">Berat Badan (kg)</Label>
                    <Input
                      id="weightKg"
                      type="number"
                      step="0.1"
                      min="1"
                      max="300"
                      required
                      value={weightKg}
                      onChange={(event) => setWeightKg(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="note">Catatan</Label>
                    <Input id="note" value={note} onChange={(event) => setNote(event.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
                  <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                    Simpan
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">No</TableHead>
            <TableHead>Tanggal</TableHead>
            <TableHead>Tinggi Badan (cm)</TableHead>
            <TableHead>Berat Badan (kg)</TableHead>
            <TableHead>IMT</TableHead>
            <TableHead>Catatan</TableHead>
            {canEdit ? <TableHead className="w-16 text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canEdit ? 7 : 6} className="text-muted-foreground py-8 text-center">
                Belum ada pengukuran untuk siswa ini.
              </TableCell>
            </TableRow>
          ) : (
            ordered.map((point, index) => (
              <TableRow key={point.id}>
                <TableCell>{index + 1}</TableCell>
                <TableCell>{point.measuredAt}</TableCell>
                <TableCell>{point.heightCm}</TableCell>
                <TableCell>{point.weightKg}</TableCell>
                <TableCell>{formatBmi(point.bmi)}</TableCell>
                <TableCell>{point.note ?? "-"}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus pengukuran ${point.measuredAt}`}
                      onClick={() => remove(point)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

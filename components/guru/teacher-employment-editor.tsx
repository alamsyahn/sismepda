"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const positions = ["Kepala Sekolah", "Wakil Kepala Sekolah", "Wakil Kurikulum", "Wakil Kesiswaan", "Guru", "Guru BK", "Kepala Tata Usaha"]

export function TeacherEmploymentEditor({ teacherId, initial }: {
  teacherId: string
  initial: { employmentStatus: string | null; position: string | null; teachingSince: string; belajarId: string | null; subjects: string[] }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(initial.employmentStatus ?? "none")
  const [position, setPosition] = useState(initial.position ?? "")
  const [teachingSince, setTeachingSince] = useState(initial.teachingSince)
  const [belajarId, setBelajarId] = useState(initial.belajarId ?? "")
  const [subjects, setSubjects] = useState(initial.subjects.join(", "))

  async function save() {
    setSaving(true)
    try {
      const response = await fetch(`/api/teachers/${teacherId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employmentStatus: status === "none" ? null : status,
          position,
          teachingSince,
          belajarId,
          subjectNames: subjects.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Data guru gagal disimpan")
      toast.success("Data kepegawaian diperbarui")
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Data guru gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Pencil className="size-4" />Edit Data Kepegawaian</Button>
      <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Data Kepegawaian</DialogTitle><DialogDescription>Status, jabatan, TMT, akun belajar.id, dan mata pelajaran yang diampu.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="employment-status">Status kepegawaian</Label>
                <Select value={status} onValueChange={(value) => value && setStatus(value)}>
                  <SelectTrigger id="employment-status" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Belum ditentukan</SelectItem>
                    <SelectItem value="PNS">PNS</SelectItem>
                    <SelectItem value="PPPK">PPPK</SelectItem>
                    <SelectItem value="HONORER">Honorer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="employment-position">Jabatan</Label>
                <Input id="employment-position" list="position-options" value={position} onChange={(event) => setPosition(event.target.value)} placeholder="Guru" />
                <datalist id="position-options">{positions.map((item) => <option key={item} value={item} />)}</datalist>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="employment-tmt">TMT mengajar</Label><Input id="employment-tmt" type="date" value={teachingSince} onChange={(event) => setTeachingSince(event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="employment-belajar">Akun belajar.id</Label><Input id="employment-belajar" value={belajarId} onChange={(event) => setBelajarId(event.target.value)} placeholder="nama@guru.smp.belajar.id" /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="employment-subjects">Mata pelajaran diampu</Label>
              <Input id="employment-subjects" value={subjects} onChange={(event) => setSubjects(event.target.value)} placeholder="Matematika, Informatika" />
              <p className="text-xs text-muted-foreground">Pisahkan dengan koma untuk lebih dari satu mata pelajaran.</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{saving ? "Menyimpan..." : "Simpan Perubahan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

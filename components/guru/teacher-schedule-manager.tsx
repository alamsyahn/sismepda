"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatPeriodRange } from "@/lib/teacher-profile"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"

type ScheduleGroup = { day: number; label: string; items: Array<{ id: string; periodStart: number; periodEnd: number; schoolClass: { name: string }; subject: { name: string } }> }
type Duty = { id: string; title: string; note: string | null; startDate: Date | null }

const days = [
  { value: "1", label: "Senin" }, { value: "2", label: "Selasa" }, { value: "3", label: "Rabu" },
  { value: "4", label: "Kamis" }, { value: "5", label: "Jumat" }, { value: "6", label: "Sabtu" },
]

export function TeacherScheduleManager({
  teacherId, schedule, duties, classes, subjects, canManage,
}: {
  teacherId: string
  schedule: ScheduleGroup[]
  duties: Duty[]
  classes: Array<{ id: string; name: string }>
  subjects: Array<{ id: string; name: string }>
  canManage: boolean
}) {
  const router = useRouter()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [dutyOpen, setDutyOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [className, setClassName] = useState(classes[0]?.name ?? "")
  const [subjectName, setSubjectName] = useState(subjects[0]?.name ?? "")
  const [day, setDay] = useState("1")
  const [periodStart, setPeriodStart] = useState("1")
  const [periodEnd, setPeriodEnd] = useState("2")
  const [dutyTitle, setDutyTitle] = useState("")
  const [dutyNote, setDutyNote] = useState("")
  const [dutyStart, setDutyStart] = useState("")

  async function send(url: string, method: string, body: unknown, successMessage: string) {
    setSaving(true)
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Permintaan gagal diproses")
      toast.success(successMessage)
      setScheduleOpen(false)
      setDutyOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Permintaan gagal diproses")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
      <Card className="border-border/70">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="size-5" /></span>
              <div><CardTitle>Jadwal Mengajar</CardTitle><CardDescription>Jadwal mingguan berdasarkan hari dan jam pelajaran.</CardDescription></div>
            </div>
            {canManage ? <Button onClick={() => setScheduleOpen(true)}><Plus className="size-4" />Tambah Jadwal</Button> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {schedule.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada jadwal mengajar yang tercatat.</p>
          ) : schedule.map((group) => (
            <div key={group.day} className="rounded-xl border border-border/60">
              <p className="border-b bg-muted/30 px-4 py-2 text-sm font-semibold">{group.label}</p>
              <Table>
                <TableHeader><TableRow><TableHead>Jam</TableHead><TableHead>Kelas</TableHead><TableHead>Mata Pelajaran</TableHead>{canManage ? <TableHead className="text-right">Aksi</TableHead> : null}</TableRow></TableHeader>
                <TableBody>
                  {group.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{formatPeriodRange(item.periodStart, item.periodEnd)}</TableCell>
                      <TableCell>{item.schoolClass.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.subject.name}</TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={saving}
                            onClick={() => send(`/api/teachers/${teacherId}/schedule`, "DELETE", { id: item.id }, "Jadwal dihapus")}>
                            <Trash2 className="size-4" />Hapus
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div><CardTitle>Tugas Tambahan</CardTitle><CardDescription>Tugas di luar jam mengajar.</CardDescription></div>
            {canManage ? <Button variant="outline" size="sm" onClick={() => setDutyOpen(true)}><Plus className="size-4" />Tambah</Button> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {duties.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada tugas tambahan.</p>
          ) : duties.map((duty) => (
            <div key={duty.id} className="rounded-xl border border-border/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{duty.title}</p>
                  {duty.note ? <p className="mt-0.5 text-sm text-muted-foreground">{duty.note}</p> : null}
                  {duty.startDate ? <Badge variant="secondary" className="mt-2">Sejak {formatSchoolDate(fromPrismaDate(duty.startDate), { day: "numeric", month: "short", year: "numeric" })}</Badge> : null}
                </div>
                {canManage ? (
                  <Button variant="ghost" size="icon-sm" aria-label={`Hapus tugas ${duty.title}`} disabled={saving}
                    onClick={() => send(`/api/teachers/${teacherId}/duties`, "DELETE", { id: duty.id }, "Tugas tambahan dihapus")}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={scheduleOpen} onOpenChange={(value) => { if (!saving) setScheduleOpen(value) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Tambah Jadwal Mengajar</DialogTitle><DialogDescription>Pilih hari, jam pelajaran, kelas, dan mata pelajaran.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="schedule-day">Hari</Label>
                <Select value={day} onValueChange={(value) => value && setDay(value)}>
                  <SelectTrigger id="schedule-day" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{days.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="schedule-class">Kelas</Label>
                <Select value={className} onValueChange={(value) => value && setClassName(value)}>
                  <SelectTrigger id="schedule-class" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">{classes.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="schedule-start">Jam ke- (mulai)</Label><Input id="schedule-start" type="number" min={1} max={12} value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="schedule-end">Jam ke- (selesai)</Label><Input id="schedule-end" type="number" min={1} max={12} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="schedule-subject">Mata pelajaran</Label><Input id="schedule-subject" list="subject-options" value={subjectName} onChange={(event) => setSubjectName(event.target.value)} placeholder="Contoh: Matematika" />
              <datalist id="subject-options">{subjects.map((item) => <option key={item.id} value={item.name} />)}</datalist>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
            <Button disabled={saving} onClick={() => send(`/api/teachers/${teacherId}/schedule`, "POST", { className, subjectName, day: Number(day), periodStart: Number(periodStart), periodEnd: Number(periodEnd) }, "Jadwal ditambahkan")}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Simpan Jadwal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dutyOpen} onOpenChange={(value) => { if (!saving) setDutyOpen(value) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Tambah Tugas Tambahan</DialogTitle><DialogDescription>Contoh: Pembina Ekstrakurikuler Seni, Bendahara BOS.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="duty-title">Nama tugas</Label><Input id="duty-title" value={dutyTitle} onChange={(event) => setDutyTitle(event.target.value)} placeholder="Pembina Ekstrakurikuler Seni" /></div>
            <div className="space-y-1.5"><Label htmlFor="duty-note">Keterangan</Label><Input id="duty-note" value={dutyNote} onChange={(event) => setDutyNote(event.target.value)} placeholder="Opsional" /></div>
            <div className="space-y-1.5"><Label htmlFor="duty-start">Mulai bertugas</Label><Input id="duty-start" type="date" value={dutyStart} onChange={(event) => setDutyStart(event.target.value)} /></div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
            <Button disabled={saving || dutyTitle.trim().length < 2} onClick={() => send(`/api/teachers/${teacherId}/duties`, "POST", { title: dutyTitle, note: dutyNote, startDate: dutyStart }, "Tugas tambahan ditambahkan")}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}Simpan Tugas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

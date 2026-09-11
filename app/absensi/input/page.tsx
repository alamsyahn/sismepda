"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CalendarOff,
  CheckCheck,
  ClipboardCheck,
  ClipboardList,
  Eraser,
  Loader2,
  Save,
  CircleCheckBig,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { DateFilter } from "@/components/date-filter"
import { AttendanceEditor } from "@/components/absensi/attendance-editor"
import { StatusSummary } from "@/components/absensi/status-summary"
import {
  currentJam,
  formatJam,
  type InputStatus,
} from "@/lib/attendance-input"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"
import { ProfileNameLink } from "@/components/profile/profile-name-link"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"

type ApiClass = { id: string; name: string; homeroomUser: { id: string; name: string } | null; students: Array<{ id: string; nis: string | null; nisn: string | null; name: string }>; attendanceDays: Array<{ submittedAt: string; updatedAt: string; submittedBy: { id: string; name: string }; attendances: Array<{ studentId: string; status: string; note: string | null }> }> }

function emptyCounts(): Record<InputStatus, number> {
  return { belum: 0, hadir: 0, sakit: 0, izin: 0, alfa: 0, dispensasi: 0 }
}

export default function AbsensiInputPage() {
  const { timeZone, today } = useSchoolTimeZone()
  const [date, setDate] = useState<string>(() => today())
  const [dateReady, setDateReady] = useState(false)
  const [requestedClass, setRequestedClass] = useState("")
  const [selectedClass, setSelectedClass] = useState("")
  const [classes, setClasses] = useState<ApiClass[]>([])
  const [holiday, setHoliday] = useState<{ id: string; name: string } | null>(null)
  const [statuses, setStatuses] = useState<Record<string, InputStatus>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [lastSaved, setLastSaved] = useState<{ time: string; by: { id: string; name: string } } | null>(null)

  // Dialog state
  const [pendingClass, setPendingClass] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [unsavedOpen, setUnsavedOpen] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedDate = params.get("date")
    if (requestedDate) setDate(parseSchoolDate(requestedDate) ?? today())
    setRequestedClass(params.get("classId") ?? "")
    setDateReady(true)
  }, [today])
  const dateLabel = formatSchoolDate(parseSchoolDate(date) ?? today())
  useEffect(() => {
    if (!dateReady) return
    fetch(`/api/attendance?date=${date}`)
      .then((r) => r.json())
      .then((data) => {
        const requested = data.classes.find((c: ApiClass) => c.id === requestedClass)
        const saved = requested?.attendanceDays[0]?.attendances ?? []
        const nextStatuses: Record<string, InputStatus> = {}
        const nextNotes: Record<string, string> = {}

        for (const student of requested?.students ?? []) {
          const record = saved.find((item: ApiClass["attendanceDays"][number]["attendances"][number]) => item.studentId === student.id)
          nextStatuses[student.id] = (record?.status.toLowerCase() as InputStatus) ?? "belum"
          nextNotes[student.id] = record?.note ?? ""
        }

        setClasses(data.classes)
        setHoliday(data.holiday)
        setSelectedClass(requested?.id ?? "")
        setStatuses(nextStatuses)
        setNotes(nextNotes)
        setHasSaved(Boolean(requested?.attendanceDays.length))
        setLastSaved(requested?.attendanceDays[0]?.updatedAt
          ? { time: formatJam(requested.attendanceDays[0].updatedAt, timeZone), by: requested.attendanceDays[0].submittedBy }
          : null)
      })
      .catch(() => toast.error("Gagal memuat kelas"))
  }, [date, dateReady, requestedClass, timeZone])
  const selected = classes.find((c) => c.id === selectedClass)
  const classOption = useMemo(
    () => selected ? { id: selected.id, name: selected.name, total: selected.students.length, homeroom: selected.homeroomUser?.name ?? "Admin", submitted: selected.attendanceDays.length > 0, submittedAt: selected.attendanceDays[0]?.updatedAt ?? null } : undefined,
    [selected],
  )
  const roster = useMemo(() => (selected?.students ?? []).map((s, i) => ({ ...s, no: i + 1 })), [selected])

  const counts = useMemo(() => {
    const c = emptyCounts()
    for (const s of roster) {
      const status = statuses[s.id] ?? "belum"
      c[status] += 1
    }
    return c
  }, [roster, statuses])

  const belumCount = counts.belum

  // Peringatan sebelum menutup / refresh tab jika ada perubahan belum tersimpan
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  const applyClass = useCallback((id: string) => {
    const cls = classes.find((c) => c.id === id)
    const option = cls ? { submitted: cls.attendanceDays.length > 0, submittedAt: cls.attendanceDays[0]?.updatedAt, submittedBy: cls.attendanceDays[0]?.submittedBy } : undefined
    const list = cls?.students ?? []
    const saved = cls?.attendanceDays[0]?.attendances ?? []
    const nextStatuses: Record<string, InputStatus> = {}
    const nextNotes: Record<string, string> = {}
    for (const s of list) {
      const record = saved.find((r) => r.studentId === s.id)
      nextStatuses[s.id] = (record?.status.toLowerCase() as InputStatus) ?? "belum"
      nextNotes[s.id] = record?.note ?? ""
    }
    setSelectedClass(id)
    setStatuses(nextStatuses)
    setNotes(nextNotes)
    setDirty(false)
    if (option?.submitted && option.submittedAt) {
      setHasSaved(true)
      setLastSaved({ time: formatJam(option.submittedAt, timeZone), by: option.submittedBy })
    } else {
      setHasSaved(false)
      setLastSaved(null)
    }
  }, [classes, timeZone])

  const handleClassChange = useCallback(
    (id: string) => {
      if (id === selectedClass) return
      if (dirty) {
        setPendingClass(id)
        setUnsavedOpen(true)
        return
      }
      applyClass(id)
    },
    [selectedClass, dirty, applyClass],
  )

  const handleStatus = useCallback((studentId: string, status: InputStatus) => {
    setStatuses((prev) => ({ ...prev, [studentId]: status }))
    setDirty(true)
  }, [])

  const handleNote = useCallback((studentId: string, note: string) => {
    setNotes((prev) => ({ ...prev, [studentId]: note }))
    setDirty(true)
  }, [])

  const handleAllPresent = useCallback(() => {
    setStatuses((prev) => {
      const next = { ...prev }
      for (const s of roster) next[s.id] = "hadir"
      return next
    })
    setDirty(true)
  }, [roster])

  const confirmClear = useCallback(() => {
    setStatuses((prev) => {
      const next = { ...prev }
      for (const s of roster) next[s.id] = "belum"
      return next
    })
    setNotes((prev) => {
      const next = { ...prev }
      for (const s of roster) next[s.id] = ""
      return next
    })
    setDirty(true)
    setClearOpen(false)
  }, [roster])

  const doSave = useCallback(async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classId: selectedClass, date, records: roster.map((s) => ({ studentId: s.id, status: (statuses[s.id] ?? "belum").toUpperCase(), note: notes[s.id] })) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Absensi gagal disimpan")
      const time = currentJam(timeZone)
      setSaving(false)
      setSaveOpen(false)
      setSavedAt(time)
      setHasSaved(true)
      setDirty(false)
      setLastSaved({ time, by: data.submittedBy })
      setSuccessOpen(true)
      toast.success("Absensi tersimpan", {
        description: `${classOption?.name ?? ""} • pukul ${time}`,
      })
    } catch (error) { setSaving(false); toast.error(error instanceof Error ? error.message : "Absensi gagal disimpan") }
  }, [classOption, selectedClass, date, roster, statuses, notes, timeZone])

  const confirmLeave = useCallback(() => {
    setUnsavedOpen(false)
    if (pendingClass) {
      applyClass(pendingClass)
      setPendingClass(null)
    }
  }, [pendingClass, applyClass])

  const saveLabel = hasSaved && dirty ? "Simpan Perubahan" : "Simpan Absensi"

  return (
    <PageContainer>
      <PageHeading
        title="Input Absensi"
        description={`Catat kehadiran siswa untuk ${dateLabel}`}
        action={
          <DateFilter value={date} onChange={(value) => { if (dirty) { toast.error("Simpan atau batalkan perubahan sebelum mengganti tanggal"); return } setDate(value) }} ariaLabel="Tanggal absensi" />
        }
      />

      {holiday ? <Card className="border-primary/30 bg-primary/5"><CardContent className="flex items-center gap-3 py-5"><span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarOff className="size-5" /></span><div><p className="font-semibold">Hari libur: {holiday.name}</p><p className="text-sm text-muted-foreground">Input absensi dinonaktifkan untuk tanggal ini.</p></div></CardContent></Card> : null}

      {/* Pemilihan kelas */}
      <Card className="border-border/60 shadow-sm">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full space-y-1.5 sm:max-w-xs">
            <Label htmlFor="pilih-kelas">Pilih Kelas</Label>
            <Select value={selectedClass} disabled={Boolean(holiday)} onValueChange={(value) => value && handleClassChange(value)}>
              <SelectTrigger id="pilih-kelas" className="w-full bg-card shadow-sm">
                <SelectValue placeholder="Pilih kelas...">
                  {(value: string) => classes.find((c) => c.id === value)?.name ?? "Pilih kelas..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {classes.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {classOption ? (
            <div className="flex flex-col gap-1 text-sm sm:items-end">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <ClipboardCheck className="size-4 text-primary" />
                {classOption.total} siswa
              </span>
              {lastSaved ? (
                <span className="text-xs text-muted-foreground">
                  Terakhir disimpan pukul {lastSaved.time} oleh <ProfileNameLink type="teacher" id={lastSaved.by.id} name={lastSaved.by.name} />
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Belum pernah disimpan pada tanggal ini</span>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!classOption ? (
        <Card className="border-dashed border-border shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ClipboardList className="size-7" />
            </span>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Belum ada kelas dipilih</p>
              <p className="text-sm text-muted-foreground text-pretty">
                Pilih kelas untuk mulai mengisi absensi siswa.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Toolbar aksi massal + ringkasan */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={handleAllPresent}>
                  <CheckCheck className="size-4" />
                  Semua Hadir
                </Button>
                <Button variant="outline" onClick={() => setClearOpen(true)}>
                  <Eraser className="size-4" />
                  Kosongkan Semua
                </Button>
              </div>
              <div className="flex items-center gap-3">
                {dirty ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--chart-4)]">
                    <span className="size-2 rounded-full bg-[var(--chart-4)]" aria-hidden />
                    Ada perubahan yang belum disimpan
                  </span>
                ) : null}
                <Button onClick={() => setSaveOpen(true)} disabled={saving}>
                  <Save className="size-4" />
                  {saveLabel}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="py-4">
              <StatusSummary counts={counts} />
            </CardContent>
          </Card>

          {/* Daftar siswa */}
          <AttendanceEditor
            roster={roster}
            statuses={statuses}
            notes={notes}
            onStatus={handleStatus}
            onNote={handleNote}
          />

          {/* Aksi simpan bawah (desktop) */}
          <div className="hidden items-center justify-between gap-4 rounded-xl border border-border/60 bg-card px-5 py-4 shadow-sm lg:flex">
            <p className="text-sm text-muted-foreground">
              {belumCount > 0 ? (
                <>
                  <span className="font-semibold text-foreground">{belumCount} siswa</span> belum
                  diisi status kehadirannya.
                </>
              ) : (
                "Seluruh siswa sudah memiliki status kehadiran."
              )}
            </p>
            <Button size="lg" onClick={() => setSaveOpen(true)} disabled={saving}>
              <Save className="size-4" />
              {saveLabel}
            </Button>
          </div>

          {/* Aksi simpan sticky (mobile) */}
          <div className="sticky bottom-0 z-30 -mx-4 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {belumCount > 0 ? `${belumCount} belum diisi` : "Semua terisi"}
              </span>
              <Button className="flex-1 sm:flex-initial" onClick={() => setSaveOpen(true)} disabled={saving}>
                <Save className="size-4" />
                {saveLabel}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Dialog: Kosongkan Semua */}
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kosongkan seluruh data absensi?</DialogTitle>
            <DialogDescription>
              Status dan keterangan yang telah diisi pada halaman ini akan dikosongkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Batal</DialogClose>
            <Button variant="destructive" onClick={confirmClear}>
              Ya, Kosongkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Simpan Absensi / peringatan belum diisi */}
      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          if (!saving) setSaveOpen(open)
        }}
      >
        <DialogContent showCloseButton={!saving}>
          {belumCount > 0 ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="size-5 text-[var(--chart-4)]" />
                  Masih ada status yang belum diisi
                </DialogTitle>
                <DialogDescription>
                  Terdapat {belumCount} siswa yang status kehadirannya belum diisi. Anda tetap dapat
                  menyimpan data ini.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={saving} />}>
                  Kembali Periksa
                </DialogClose>
                <Button onClick={doSave} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {saving ? "Menyimpan..." : "Tetap Simpan"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Simpan data absensi?</DialogTitle>
                <DialogDescription>
                  Pastikan status kehadiran seluruh siswa sudah sesuai sebelum data disimpan.
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-muted/60 p-3 text-sm">
                <dt className="text-muted-foreground">Kelas</dt>
                <dd className="font-medium text-foreground">{classOption?.name}</dd>
                <dt className="text-muted-foreground">Tanggal</dt>
                <dd className="font-medium text-foreground">{dateLabel}</dd>
                <dt className="text-muted-foreground">Jumlah siswa</dt>
                <dd className="font-medium text-foreground">{classOption?.total}</dd>
              </dl>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
                <Button onClick={doSave} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {saving ? "Menyimpan..." : "Ya, Simpan"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Perubahan belum disimpan (ganti kelas) */}
      <Dialog open={unsavedOpen} onOpenChange={setUnsavedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Perubahan belum disimpan</DialogTitle>
            <DialogDescription>
              Perubahan data absensi pada kelas ini belum disimpan. Jika Anda meninggalkan halaman,
              perubahan akan hilang.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnsavedOpen(false)}>
              Tetap di Halaman
            </Button>
            <Button variant="destructive" onClick={confirmLeave}>
              Tinggalkan Halaman
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Berhasil disimpan */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-[var(--chart-1)]/12 text-[var(--chart-1)]">
              <CircleCheckBig className="size-7" />
            </span>
            <DialogTitle className="text-lg">Data berhasil disimpan</DialogTitle>
            <DialogDescription>
              Absensi kelas {classOption?.name} untuk {dateLabel} telah berhasil disimpan.
            </DialogDescription>
          </DialogHeader>
          {savedAt ? (
            <p className="text-center text-sm font-medium text-foreground">
              Tersimpan pukul {savedAt}
            </p>
          ) : null}
          <DialogFooter className="sm:justify-center">
            <Button className="w-full sm:w-auto sm:min-w-32" onClick={() => setSuccessOpen(false)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

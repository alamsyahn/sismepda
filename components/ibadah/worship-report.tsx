"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { formatSchoolTime } from "@/lib/school-date"
import type { readWorshipRows } from "@/lib/server-worship-attendance"
import { WORSHIP_STATUS_LABELS } from "@/lib/worship-attendance"

type Row = Awaited<ReturnType<typeof readWorshipRows>>[number]
const schoolLabels: Record<NonNullable<Row["schoolStatus"]>, string> = {
  HADIR: "Hadir", SAKIT: "Sakit", IZIN: "Izin", ALFA: "Alfa", DISPENSASI: "Dispensasi",
}
const selectClass = "h-9 rounded-md border bg-background px-3 text-sm"

export function WorshipReport({
  classId, classes, date, today, timeZone, rows, editable,
}: {
  classId: string
  classes: { id: string; name: string }[]
  date: string
  today: string
  timeZone: string
  rows: Row[]
  editable: boolean
}) {
  const router = useRouter()
  const attended = rows.filter((row) => row.worship?.status === "IKUT").length
  const excused = rows.filter((row) => row.worship?.status === "DISPENSASI").length
  const editTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone })

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const search = new URLSearchParams({ classId: String(values.get("classId")), date: String(values.get("date")) })
    if (values.get("classId") === classId && values.get("date") === date) router.refresh()
    else router.push(`/rekap-ibadah?${search}`)
  }

  return (
    <>
      <form onSubmit={filter} className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="ibadah-date">Tanggal</Label>
          <Input id="ibadah-date" type="date" name="date" defaultValue={date} max={today} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ibadah-class">Kelas</Label>
          <select id="ibadah-class" name="classId" defaultValue={classId} className={selectClass}>
            {classes.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>)}
          </select>
        </div>
        <Button type="submit" variant="outline">Tampilkan</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{attended} ikut Zuhur</Badge>
        <Badge variant="outline">{excused} dispensasi ibadah</Badge>
        <Badge variant="outline">{rows.length - attended - excused} belum ada catatan</Badge>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Siswa</TableHead>
              <TableHead>Absensi Sekolah</TableHead>
              <TableHead>Ibadah Zuhur</TableHead>
              {editable && <TableHead className="text-right">Tindakan</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{row.name}</div>
                  {row.nis && <div className="text-xs text-muted-foreground">NIS {row.nis}</div>}
                </TableCell>
                <TableCell>{row.schoolStatus ? schoolLabels[row.schoolStatus] : "Belum diisi"}</TableCell>
                <TableCell className="min-w-36 whitespace-normal">
                  <div>
                    {WORSHIP_STATUS_LABELS[row.worship?.status ?? "BELUM"]}
                    {row.worship?.firstScannedAt && ` · ${formatSchoolTime(new Date(row.worship.firstScannedAt), timeZone)}`}
                  </div>
                  {row.worship?.manualByName && (
                    <div className="mt-1 break-words text-xs text-muted-foreground">
                      <div>Manual · {row.worship.manualByName} · {editTime.format(new Date(row.worship.updatedAt))}</div>
                      <div>{row.worship.manualReason}</div>
                    </div>
                  )}
                </TableCell>
                {editable && <TableCell className="text-right"><EditWorship row={row} classId={classId} date={date} /></TableCell>}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={editable ? 4 : 3} className="py-6 text-center">Belum ada siswa di kelas ini.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function EditWorship({ row, classId, date }: { row: Row; classId: string; date: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const recorded = row.worship?.status === "IKUT" || row.worship?.status === "DISPENSASI"
  const label = recorded ? "Koreksi" : "Catat manual"

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const values = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/rekap-ibadah", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId, date, studentId: row.id, revision, status: values.get("status"), reason: values.get("reason"),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        if (response.status === 409) router.refresh()
        throw new Error(data?.error ?? "Catatan gagal disimpan")
      }
      setOpen(false)
      router.refresh()
      toast.success("Catatan ibadah tersimpan")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Catatan gagal disimpan")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (busy) return
      if (next) {
        setError("")
        setRevision(row.worship?.revision ?? 0)
      }
      setOpen(next)
    }}>
      <DialogTrigger render={<Button size="sm" variant="outline" aria-label={`${label} ibadah ${row.name}`} />}>
        {label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} ibadah Zuhur</DialogTitle>
          <DialogDescription>{row.name}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={save}>
          <div className="grid gap-2">
            <Label htmlFor={`status-${row.id}`}>Status Zuhur</Label>
            <select id={`status-${row.id}`} name="status" defaultValue={recorded ? row.worship?.status : "IKUT"}
              className={selectClass} disabled={busy}>
              <option value="IKUT">Ikut</option>
              <option value="DISPENSASI">Dispensasi ibadah</option>
              {recorded && <option value="BELUM">Hapus status ibadah</option>}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`reason-${row.id}`}>Alasan</Label>
            <Textarea id={`reason-${row.id}`} name="reason" required minLength={2} maxLength={300} disabled={busy} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

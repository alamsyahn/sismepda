"use client"

import { useState } from "react"
import { Loader2, Save } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { scheduleFetch } from "@/components/jadwal/use-schedule-resource"
import { SCHEDULE_DAY_LABELS, SCHEDULE_DAYS, type ScheduleDay } from "@/lib/schedule-constants"
import { lessonSlots, type TimeSlot } from "@/lib/schedule-time"
import type { ScheduleEntryView, ScheduleMasterData } from "@/lib/server-schedule"

export type EntryDraft = {
  id: string | null
  day: number
  period: number
  classId: string
  subjectId: string
  teacherId: string
  room: string
}

export function draftFromEntry(entry: ScheduleEntryView): EntryDraft {
  return {
    id: entry.id,
    day: entry.day,
    period: entry.period,
    classId: entry.classId,
    subjectId: entry.subjectId,
    teacherId: entry.teacherId ?? "",
    room: entry.room ?? "",
  }
}

export function emptyDraft(day: number, period: number): EntryDraft {
  return { id: null, day, period, classId: "", subjectId: "", teacherId: "", room: "" }
}

/**
 * Editor satu penempatan jadwal (workflow "perubahan kecil").
 *
 * Bentrok kelas/guru ditolak server dengan 409 dan pesannya ditampilkan apa
 * adanya — tidak ada penimpaan diam-diam, dan klien tidak mencoba menebak
 * sendiri apakah suatu perubahan aman.
 */
export function ScheduleEntryDialog({
  open,
  onOpenChange,
  draft,
  slots,
  master,
  onSaved,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  draft: EntryDraft
  slots: readonly TimeSlot[]
  master: ScheduleMasterData
  onSaved: () => void
}) {
  const [value, setValue] = useState<EntryDraft>(draft)
  const [saving, setSaving] = useState(false)
  const lessons = lessonSlots([...slots])

  // Dialog dipasang ulang tiap kali dibuka (lihat `key` di pemanggil), jadi
  // state awal cukup diambil sekali di sini.
  void draft

  async function submit() {
    if (!value.classId || !value.subjectId) {
      toast.error("Kelas dan mata pelajaran wajib dipilih")
      return
    }

    setSaving(true)
    try {
      const body = {
        ...(value.id ? { id: value.id } : {}),
        day: value.day,
        period: value.period,
        classId: value.classId,
        subjectId: value.subjectId,
        teacherId: value.teacherId ? value.teacherId : null,
        room: value.room.trim() ? value.room.trim() : null,
      }
      await scheduleFetch("/api/jadwal/entries", {
        method: value.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      toast.success(value.id ? "Jadwal diperbarui" : "Jadwal ditambahkan")
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Jadwal gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{value.id ? "Ubah Jadwal" : "Tambah Jadwal"}</DialogTitle>
          <DialogDescription>
            Perubahan langsung menjadi bagian revisi aktif dan tercatat pada audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="entry-day">Hari</Label>
              <Select
                value={String(value.day)}
                onValueChange={(next) => next && setValue((row) => ({ ...row, day: Number(next) }))}
              >
                <SelectTrigger id="entry-day" className="w-full">
                  <SelectValue>
                    {(current: string) => SCHEDULE_DAY_LABELS[Number(current) as ScheduleDay] ?? "Pilih hari"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_DAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {SCHEDULE_DAY_LABELS[day]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="entry-period">Jam pelajaran</Label>
              <Select
                value={String(value.period)}
                onValueChange={(next) => next && setValue((row) => ({ ...row, period: Number(next) }))}
              >
                <SelectTrigger id="entry-period" className="w-full">
                  <SelectValue placeholder="Pilih jam">
                    {(current: string) =>
                      lessons.find((slot) => String(slot.ascPeriod) === current)?.name ?? "Pilih jam"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {lessons.map((slot) => (
                    <SelectItem key={slot.id} value={String(slot.ascPeriod)}>
                      {slot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="entry-class">Kelas</Label>
              <Select
                value={value.classId}
                onValueChange={(next) => next && setValue((row) => ({ ...row, classId: String(next) }))}
              >
                <SelectTrigger id="entry-class" className="w-full">
                  <SelectValue placeholder="Pilih kelas">
                    {(current: string) =>
                      master.classes.find((item) => item.id === current)?.name ?? "Pilih kelas"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {master.classes.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="entry-subject">Mata pelajaran</Label>
              <Select
                value={value.subjectId}
                onValueChange={(next) => next && setValue((row) => ({ ...row, subjectId: String(next) }))}
              >
                <SelectTrigger id="entry-subject" className="w-full">
                  <SelectValue placeholder="Pilih mapel">
                    {(current: string) =>
                      master.subjects.find((item) => item.id === current)?.name ?? "Pilih mapel"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {master.subjects.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="entry-teacher">Guru</Label>
              <Select
                value={value.teacherId}
                onValueChange={(next) => next && setValue((row) => ({ ...row, teacherId: String(next) }))}
              >
                <SelectTrigger id="entry-teacher" className="w-full">
                  <SelectValue placeholder="Pilih guru">
                    {(current: string) =>
                      master.teachers.find((item) => item.id === current)?.name ?? "Pilih guru"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {master.teachers.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="entry-room">Ruang (opsional)</Label>
              <Input
                id="entry-room"
                value={value.room}
                onChange={(event) => setValue((row) => ({ ...row, room: event.target.value }))}
                placeholder="Contoh: Lab Komputer"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

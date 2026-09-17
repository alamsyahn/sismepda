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
import { Combobox } from "@/components/ui/combobox"
import { SCHEDULE_DAY_LABELS, scheduleDayLabel, type ScheduleDay } from "@/lib/schedule-constants"
import { findProfileDay, lessonSlots, orderedDays, type ProfileDay } from "@/lib/schedule-time"
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
  days,
  master,
  onSaved,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  draft: EntryDraft
  days: readonly ProfileDay[]
  master: ScheduleMasterData
  onSaved: () => void
}) {
  const [value, setValue] = useState<EntryDraft>(draft)
  const [saving, setSaving] = useState(false)

  const configured = orderedDays([...days]).filter((item) => item.slots.length > 0)
  // Jam pelajaran yang ditawarkan adalah milik hari yang sedang dipilih di
  // dialog ini. Jam ke-8 yang hanya ada pada Senin tidak boleh ikut tampil
  // ketika harinya diganti menjadi Jumat.
  const lessons = lessonSlots([...(findProfileDay(configured, value.day)?.slots ?? [])])

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
                onValueChange={(next) => {
                  if (!next) return
                  const nextDay = Number(next)
                  const periods = lessonSlots([...(findProfileDay(configured, nextDay)?.slots ?? [])])
                  setValue((row) => ({
                    ...row,
                    day: nextDay,
                    // Nomor jam yang tidak dikenal hari baru tidak dibawa pindah:
                    // server menolaknya, dan membiarkannya membuat dialog tampak
                    // memilih jam yang sebenarnya tidak ada.
                    period: periods.some((slot) => slot.ascPeriod === row.period)
                      ? row.period
                      : (periods[0]?.ascPeriod ?? row.period),
                  }))
                }}
              >
                <SelectTrigger id="entry-day" className="w-full">
                  <SelectValue>
                    {(current: string) => SCHEDULE_DAY_LABELS[Number(current) as ScheduleDay] ?? "Pilih hari"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {configured.map((item) => (
                    <SelectItem key={item.day} value={String(item.day)}>
                      {scheduleDayLabel(item.day)}
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
              <Combobox
                id="entry-class"
                options={master.classes.map((item) => ({
                  value: item.id,
                  label: item.name,
                  description: `Tingkat ${item.grade}`,
                }))}
                value={value.classId ? value.classId : null}
                placeholder="Cari kelas"
                emptyMessage="Kelas tidak ditemukan"
                onValueChange={(next) => setValue((row) => ({ ...row, classId: next ?? "" }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="entry-subject">Mata pelajaran</Label>
              <Combobox
                id="entry-subject"
                options={master.subjects.map((item) => ({ value: item.id, label: item.name }))}
                value={value.subjectId ? value.subjectId : null}
                placeholder="Cari mata pelajaran"
                emptyMessage="Mata pelajaran tidak ditemukan"
                onValueChange={(next) => setValue((row) => ({ ...row, subjectId: next ?? "" }))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="entry-teacher">Guru</Label>
              <Combobox
                id="entry-teacher"
                options={master.teachers.map((item) => ({ value: item.id, label: item.name }))}
                value={value.teacherId ? value.teacherId : null}
                placeholder="Cari guru"
                emptyMessage="Guru tidak ditemukan"
                onValueChange={(next) => setValue((row) => ({ ...row, teacherId: next ?? "" }))}
              />
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

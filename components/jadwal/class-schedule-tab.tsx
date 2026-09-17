"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Combobox } from "@/components/ui/combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import {
  SCHEDULE_DAY_LABELS,
  formatTimeRange,
  scheduleDayLabel,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { orderedDays, orderedSlots, type ProfileDay, type TimeSlot } from "@/lib/schedule-time"
import type { ScheduleEntryView, ScheduleNowContext } from "@/lib/server-schedule"

type Payload = {
  schoolClass: { id: string; name: string }
  day: number
  slots: TimeSlot[]
  entries: ScheduleEntryView[]
  now: ScheduleNowContext
}

/**
 * Tab "Jadwal Kelas".
 *
 * Hari berdefault ke hari ini, tetapi KELAS sengaja tanpa nilai bawaan: memilih
 * kelas pertama secara diam-diam membuat admin membaca jadwal kelas yang bukan
 * yang dimaksudnya, dan kekeliruan itu sulit disadari.
 */
export function ClassScheduleTab({
  classes,
  days,
  todayDay,
}: {
  classes: readonly { id: string; name: string; grade: string }[]
  days: readonly ProfileDay[]
  todayDay: ScheduleDay | null
}) {
  const configured = orderedDays([...days]).filter((item) => item.slots.length > 0)
  const initialDay =
    (todayDay !== null && configured.some((item) => item.day === todayDay)
      ? todayDay
      : configured[0]?.day) ?? 1
  const [day, setDay] = useState<ScheduleDay>(initialDay as ScheduleDay)
  const [classId, setClassId] = useState("")

  const url = classId ? `/api/jadwal/kelas?classId=${encodeURIComponent(classId)}&day=${day}` : null
  const { data, loading, error } = useScheduleResource<Payload>(url)

  const rows = data ? orderedSlots([...data.slots]) : []

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="jadwal-kelas-hari">Hari</Label>
          <Select value={String(day)} onValueChange={(value) => value && setDay(Number(value) as ScheduleDay)}>
            <SelectTrigger id="jadwal-kelas-hari" className="w-full">
              <SelectValue>
                {(value: string) => SCHEDULE_DAY_LABELS[Number(value) as ScheduleDay] ?? "Pilih hari"}
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
          <Label htmlFor="jadwal-kelas-kelas">Kelas</Label>
          <Combobox
            id="jadwal-kelas-kelas"
            options={classes.map((item) => ({ value: item.id, label: item.name, description: `Tingkat ${item.grade}` }))}
            value={classId ? classId : null}
            placeholder="Cari kelas"
            emptyMessage="Kelas tidak ditemukan"
            onValueChange={(value) => setClassId(value ?? "")}
          />
        </div>
      </div>

      {!classId ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Pilih kelas untuk melihat susunan jam, mata pelajaran, dan pengajarnya pada hari terpilih.
        </p>
      ) : loading ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Memuat jadwal kelas…
        </p>
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {error}
        </p>
      ) : data ? (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Jam</TableHead>
                <TableHead className="w-36">Waktu</TableHead>
                <TableHead>Mata Pelajaran</TableHead>
                <TableHead>Pengajar</TableHead>
                <TableHead className="w-28">Ruang</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((slot) => {
                const entry =
                  slot.ascPeriod === null
                    ? null
                    : data.entries.find((item) => item.period === slot.ascPeriod) ?? null

                if (slot.kind !== "PELAJARAN") {
                  return (
                    <TableRow key={slot.id} className="bg-muted/30">
                      <TableCell className="font-medium">{slot.name}</TableCell>
                      <TableCell>{formatTimeRange(slot.startMinute, slot.endMinute)}</TableCell>
                      <TableCell colSpan={3} className="text-muted-foreground">
                        {slot.kind === "ISTIRAHAT" ? "Istirahat" : "Kegiatan sekolah"}
                      </TableCell>
                    </TableRow>
                  )
                }

                return (
                  <TableRow key={slot.id}>
                    <TableCell className="font-medium">{slot.name}</TableCell>
                    <TableCell>{formatTimeRange(slot.startMinute, slot.endMinute)}</TableCell>
                    <TableCell>{entry ? entry.subjectName : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry ? (entry.teacherName ?? "Guru belum ditetapkan") : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{entry?.room ?? "—"}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}

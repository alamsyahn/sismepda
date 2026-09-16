"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import {
  SCHEDULE_DAY_LABELS,
  SCHEDULE_DAYS,
  formatTimeRange,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { orderedSlots, type TimeSlot } from "@/lib/schedule-time"
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
  todayDay,
}: {
  classes: readonly { id: string; name: string; grade: string }[]
  todayDay: ScheduleDay | null
}) {
  const [day, setDay] = useState<ScheduleDay>(todayDay ?? 1)
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
              {SCHEDULE_DAYS.map((item) => (
                <SelectItem key={item} value={String(item)}>
                  {SCHEDULE_DAY_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="jadwal-kelas-kelas">Kelas</Label>
          <Select value={classId} onValueChange={(value) => value && setClassId(String(value))}>
            <SelectTrigger id="jadwal-kelas-kelas" className="w-full">
              <SelectValue placeholder="Pilih kelas">
                {(value: string) => classes.find((item) => item.id === value)?.name ?? "Pilih kelas"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {classes.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

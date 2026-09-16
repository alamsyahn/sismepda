"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import {
  SCHEDULE_DAY_LABELS,
  SCHEDULE_DAYS,
  formatTimeRange,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { lessonSlots, type CurrentSlotResult, type TimeSlot } from "@/lib/schedule-time"
import type { ScheduleNowContext, ScheduleTeacher } from "@/lib/server-schedule"

type Payload = {
  day: number
  period: number
  slot: TimeSlot
  free: ScheduleTeacher[]
  teaching: (ScheduleTeacher & { className: string; subjectName: string })[]
  totalTeachers: number
  now: ScheduleNowContext
}

/**
 * Tab "Jam Kosong Guru".
 *
 * Namanya disengaja: tidak adanya jadwal mengajar TIDAK berarti guru tersedia
 * untuk tugas lain (piket, rapat, dinas luar tidak terekam modul ini).
 *
 * Bila saat ini bukan jam pelajaran, tab tidak berpura-pura punya jawaban: ia
 * menjelaskan keadaan dan meminta pengguna memilih jam pelajaran.
 */
export function FreeTeachersTab({
  slots,
  todayDay,
  current,
}: {
  slots: readonly TimeSlot[]
  todayDay: ScheduleDay | null
  current: CurrentSlotResult
}) {
  const lessons = lessonSlots([...slots])
  const [day, setDay] = useState<ScheduleDay>(todayDay ?? 1)
  const [period, setPeriod] = useState<number | null>(
    current.state === "lesson" ? current.period : null,
  )

  const url = period === null ? null : `/api/jadwal/jam-kosong?day=${day}&period=${period}`
  const { data, loading, error } = useScheduleResource<Payload>(url)

  return (
    <div className="space-y-4">
      {current.state !== "lesson" ? (
        <p className="rounded-xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
          {current.state === "break"
            ? `Saat ini ${current.slot.name} (${formatTimeRange(current.slot.startMinute, current.slot.endMinute)}) — bukan jam pelajaran.`
            : "Saat ini di luar jam pelajaran."}{" "}
          Pilih hari dan jam pelajaran untuk melihat guru yang tidak memiliki jadwal mengajar pada jam tersebut.
        </p>
      ) : null}

      <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="jam-kosong-hari">Hari</Label>
          <Select value={String(day)} onValueChange={(value) => value && setDay(Number(value) as ScheduleDay)}>
            <SelectTrigger id="jam-kosong-hari" className="w-full">
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
          <Label htmlFor="jam-kosong-jam">Jam pelajaran</Label>
          <Select
            value={period === null ? "" : String(period)}
            onValueChange={(value) => value && setPeriod(Number(value))}
          >
            <SelectTrigger id="jam-kosong-jam" className="w-full">
              <SelectValue placeholder="Pilih jam pelajaran">
                {(value: string) =>
                  lessons.find((slot) => String(slot.ascPeriod) === value)?.name ?? "Pilih jam pelajaran"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {lessons.map((slot) => (
                <SelectItem key={slot.id} value={String(slot.ascPeriod)}>
                  {slot.name} · {formatTimeRange(slot.startMinute, slot.endMinute)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {period === null ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Belum ada jam pelajaran yang dipilih.
        </p>
      ) : loading ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Menghitung jam kosong…
        </p>
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {error}
        </p>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Tidak mengajar
                <Badge variant="secondary">{data.free.length}</Badge>
              </CardTitle>
              <CardDescription>
                {SCHEDULE_DAY_LABELS[data.day as ScheduleDay]} · {data.slot.name} ·{" "}
                {formatTimeRange(data.slot.startMinute, data.slot.endMinute)}. Tidak ada jadwal mengajar
                bukan jaminan guru bebas tugas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.free.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Seluruh guru memiliki jadwal mengajar pada jam ini.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.free.map((teacher) => (
                    <li key={teacher.id} className="py-2 text-sm">
                      {teacher.name}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Sedang mengajar
                <Badge variant="secondary">{data.teaching.length}</Badge>
              </CardTitle>
              <CardDescription>Dari {data.totalTeachers} guru pada populasi modul Jadwal.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.teaching.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Belum ada jadwal mengajar pada jam ini.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.teaching.map((teacher) => (
                    <li key={teacher.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <span>{teacher.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {teacher.className} · {teacher.subjectName}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

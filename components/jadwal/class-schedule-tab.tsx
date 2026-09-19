"use client"

import { useState } from "react"
import { CalendarRange, Loader2, School } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClassPicker } from "@/components/jadwal/class-picker"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import {
  SCHEDULE_DAY_LABELS,
  formatTimeRange,
  scheduleDayLabel,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { orderedDays, orderedSlots, type ProfileDay, type TimeSlot } from "@/lib/schedule-time"
import type { CurrentSlotResult } from "@/lib/schedule-time"
import {
  SLOT_TONE_CLASS,
  formatClassShortName,
  isCurrentSlot,
  slotKindLabel,
  slotTone,
} from "@/lib/schedule-presentation"
import type { ScheduleEntryView, ScheduleNowContext } from "@/lib/server-schedule"
import { cn } from "@/lib/utils"

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
  current,
}: {
  classes: readonly { id: string; name: string; grade: string }[]
  days: readonly ProfileDay[]
  todayDay: ScheduleDay | null
  /** Konteks "sekarang" dari server; tanpa ini tidak ada badge "Sekarang". */
  current?: CurrentSlotResult
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
  // Urutan dan pengelompokan kelas ditangani `ClassPicker`; di sini hanya
  // dibutuhkan tingkat kelas terpilih untuk menulis namanya secara ringkas.
  const selectedClass = classes.find((item) => item.id === classId) ?? null
  const isToday = data ? data.day === (data.now.todayDay ?? todayDay) : false

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[13rem]">
          <Label htmlFor="jadwal-kelas-hari" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" aria-hidden />
            Hari
          </Label>
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

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[16rem]">
          <Label htmlFor="jadwal-kelas-kelas" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <School className="size-3.5" aria-hidden />
            Kelas
          </Label>
          <ClassPicker
            id="jadwal-kelas-kelas"
            classes={classes}
            value={classId}
            onValueChange={setClassId}
          />
        </div>

        {/* Konteks hasil filter, bukan kartu besar tersendiri. */}
        {data ? (
          <p className="flex items-center gap-2 pb-2 text-sm font-medium">
            {scheduleDayLabel(data.day)} ·{" "}
            {selectedClass ? formatClassShortName(selectedClass) : data.schoolClass.name}
            {isToday ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                Hari ini
              </Badge>
            ) : null}
          </p>
        ) : null}
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
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-36 text-xs font-semibold text-foreground">Jam</TableHead>
                <TableHead className="w-32 text-xs font-semibold text-foreground">Waktu</TableHead>
                <TableHead className="text-xs font-semibold text-foreground">Mata Pelajaran</TableHead>
                <TableHead className="text-xs font-semibold text-foreground">Pengajar</TableHead>
                <TableHead className="w-24 text-xs font-semibold text-foreground">Ruang</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((slot) => {
                const entry =
                  slot.ascPeriod === null
                    ? null
                    : data.entries.find((item) => item.period === slot.ascPeriod) ?? null
                const tone = slotTone(slot, entry !== null)
                const isNow = current ? isCurrentSlot(current, slot, isToday) : false

                const rowClass = cn(
                  "transition-colors duration-150",
                  SLOT_TONE_CLASS[tone],
                  isNow && "bg-primary/[0.06] hover:bg-primary/[0.09]",
                )

                if (slot.kind !== "PELAJARAN") {
                  return (
                    <TableRow key={slot.id} className={rowClass} aria-current={isNow ? "time" : undefined}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1.5">
                          {slot.name}
                          {isNow ? (
                            <Badge className="h-4 px-1.5 text-[10px] font-semibold tracking-wide uppercase">
                              Sekarang
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatTimeRange(slot.startMinute, slot.endMinute)}
                      </TableCell>
                      {/* Label jenis baris tetap tertulis: warna saja tidak boleh
                          menjadi satu-satunya pembeda status. */}
                      <TableCell colSpan={3} className="text-muted-foreground">
                        {slotKindLabel(slot)}
                      </TableCell>
                    </TableRow>
                  )
                }

                return (
                  <TableRow key={slot.id} className={rowClass} aria-current={isNow ? "time" : undefined}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {slot.name}
                        {isNow ? (
                          <Badge className="h-4 px-1.5 text-[10px] font-semibold tracking-wide uppercase">
                            Sekarang
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatTimeRange(slot.startMinute, slot.endMinute)}
                    </TableCell>
                    <TableCell>
                      {entry ? (
                        <span className="font-medium text-foreground">{entry.subjectName}</span>
                      ) : (
                        <span className="text-muted-foreground/70">Tidak ada jadwal</span>
                      )}
                    </TableCell>
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

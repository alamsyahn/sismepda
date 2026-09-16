"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScheduleWeekGrid } from "@/components/jadwal/schedule-week-grid"
import { useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import type { ScheduleDay } from "@/lib/schedule-constants"
import type { TimeSlot } from "@/lib/schedule-time"
import type { ScheduleEntryView, ScheduleNowContext, ScheduleTeacher } from "@/lib/server-schedule"

type Payload = {
  teacherId: string
  slots: TimeSlot[]
  entries: ScheduleEntryView[]
  now: ScheduleNowContext
}

/**
 * Tab "Jadwal Saya".
 *
 * Bagi guru, tab ini langsung terisi tanpa memilih nama: server memakai
 * identitas pemanggil ketika `teacherId` tidak dikirim. Pemakai berwenang yang
 * BUKAN guru tidak diberi pesan galat — bagi mereka tab ini menjadi pencarian
 * jadwal per guru, dengan pilihan guru yang wajib diisi lebih dulu.
 */
export function MyScheduleTab({
  viewerId,
  viewerIsTeacher,
  canPickTeacher,
  teachers,
  todayDay,
}: {
  viewerId: string
  viewerIsTeacher: boolean
  canPickTeacher: boolean
  teachers: readonly ScheduleTeacher[]
  todayDay: ScheduleDay | null
}) {
  const [teacherId, setTeacherId] = useState<string>(viewerIsTeacher ? viewerId : "")

  const url = teacherId ? `/api/jadwal/guru?teacherId=${encodeURIComponent(teacherId)}` : null
  const { data, loading, error } = useScheduleResource<Payload>(url)

  return (
    <div className="space-y-4">
      {canPickTeacher ? (
        <div className="flex flex-col gap-1.5 sm:max-w-sm">
          <Label htmlFor="jadwal-guru">Guru</Label>
          <Select value={teacherId} onValueChange={(value) => value && setTeacherId(String(value))}>
            <SelectTrigger id="jadwal-guru" className="w-full">
              <SelectValue placeholder="Pilih guru">
                {(value: string) => teachers.find((item) => item.id === value)?.name ?? "Pilih guru"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {teachers.map((teacher) => (
                <SelectItem key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!teacherId ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {canPickTeacher
            ? "Pilih guru untuk melihat jadwal mingguannya."
            : "Akun Anda belum terhubung dengan Data Master Guru, sehingga jadwal pribadi belum dapat ditampilkan."}
        </p>
      ) : loading ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Memuat jadwal…
        </p>
      ) : error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          {error}
        </p>
      ) : data ? (
        <ScheduleWeekGrid
          slots={data.slots}
          entries={data.entries}
          highlightDay={data.now.todayDay ?? todayDay}
          showClass
        />
      ) : null}
    </div>
  )
}

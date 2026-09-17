"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Combobox } from "@/components/ui/combobox"
import { ScheduleWeekGrid } from "@/components/jadwal/schedule-week-grid"
import { useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import type { ScheduleDay } from "@/lib/schedule-constants"
import type { ProfileDay } from "@/lib/schedule-time"
import type { ScheduleEntryView, ScheduleNowContext, ScheduleTeacher } from "@/lib/server-schedule"

type Payload = {
  teacherId: string
  days: ProfileDay[]
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
          <Combobox
            id="jadwal-guru"
            options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))}
            value={teacherId ? teacherId : null}
            disabled={teachers.length === 0}
            placeholder="Cari nama guru"
            emptyMessage="Guru tidak ditemukan"
            onValueChange={(value) => setTeacherId(value ?? "")}
          />
        </div>
      ) : null}

      {canPickTeacher && teachers.length === 0 ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-muted-foreground">
          Belum ada guru yang memenuhi syarat modul Jadwal. Syaratnya: akun aktif, tertaut Data Master
          Guru, dan memegang role dengan key “guru”. Akun yang hanya memegang role lama “legacy_guru”
          belum terhitung.
        </p>
      ) : !teacherId ? (
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
          days={data.days}
          entries={data.entries}
          highlightDay={data.now.todayDay ?? todayDay}
          showClass
        />
      ) : null}
    </div>
  )
}

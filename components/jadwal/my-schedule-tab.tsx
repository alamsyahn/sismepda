"use client"

import { useState } from "react"
import { Loader2, Users } from "lucide-react"

import { Label } from "@/components/ui/label"
import { TeacherAutocomplete } from "@/components/jadwal/teacher-autocomplete"
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
  /**
   * Guru yang BENAR-BENAR dipilih — satu-satunya pemicu pemuatan jadwal.
   *
   * Sengaja menyimpan objek, bukan sekadar id, supaya kotak pencarian dapat
   * menampilkan nama tanpa menelusuri ulang daftar. Teks yang sedang diketik
   * hidup di dalam `TeacherAutocomplete` sebagai `query` dan TIDAK pernah
   * masuk ke state ini: ketikan yang kebetulan cocok bukan sebuah pilihan.
   *
   * Guru yang membuka tabnya sendiri langsung terisi. Bagi pemakai berwenang
   * yang bukan guru, nilainya null sampai ia memilih dari hasil pencarian.
   */
  const [selectedTeacher, setSelectedTeacher] = useState<ScheduleTeacher | null>(() => {
    if (!viewerIsTeacher) return null
    // `viewerIsTeacher` dan populasi `teachers` memakai syarat yang sama,
    // sehingga pencarian ini normalnya selalu ketemu. Bila suatu saat tidak,
    // identitas pemanggil tetap dipakai agar jadwalnya tidak hilang diam-diam.
    return teachers.find((teacher) => teacher.id === viewerId) ?? { id: viewerId, name: "Jadwal saya" }
  })

  // Pemakai non-guru tanpa hak memilih tetap memakai identitasnya sendiri:
  // server menolak/menentukan sendiri bila id itu bukan miliknya.
  const teacherId = canPickTeacher ? selectedTeacher?.id ?? "" : viewerIsTeacher ? viewerId : ""

  const url = teacherId ? `/api/jadwal/guru?teacherId=${encodeURIComponent(teacherId)}` : null
  const { data, loading, error } = useScheduleResource<Payload>(url)

  return (
    <div className="space-y-4">
      {canPickTeacher ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-sm">
            <Label htmlFor="jadwal-guru" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5" aria-hidden />
              Guru
            </Label>
            <TeacherAutocomplete
              id="jadwal-guru"
              teachers={teachers}
              value={selectedTeacher}
              disabled={teachers.length === 0}
              onValueChange={setSelectedTeacher}
            />
          </div>
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
          current={data.now.current}
          showClass
        />
      ) : null}
    </div>
  )
}

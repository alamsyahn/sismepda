"use client"

import { useState } from "react"
import { BookOpenCheck, CalendarRange, CircleMinus, Clock3, Info, Loader2, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import { filterBySearchQuery } from "@/lib/entity-search"
import {
  SCHEDULE_DAY_LABELS,
  formatTimeRange,
  scheduleDayLabel,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import {
  findProfileDay,
  lessonSlots,
  orderedDays,
  type CurrentSlotResult,
  type ProfileDay,
  type TimeSlot,
} from "@/lib/schedule-time"
import type { ScheduleNowContext, ScheduleTeacher } from "@/lib/server-schedule"
import { cn } from "@/lib/utils"

type TeachingTeacher = ScheduleTeacher & { className: string; subjectName: string }

type Payload = {
  day: number
  period: number
  slot: TimeSlot
  free: ScheduleTeacher[]
  teaching: TeachingTeacher[]
  totalTeachers: number
  now: ScheduleNowContext
}

/**
 * Panel daftar guru.
 *
 * Dua panel memakai komponen yang sama supaya perbedaannya murni semantic
 * (nada + ikon + judul), bukan dua tata letak yang kebetulan mirip.
 */
function TeacherPanel({
  title,
  icon: Icon,
  tone,
  count,
  caption,
  emptyMessage,
  children,
}: {
  title: string
  icon: typeof CircleMinus
  tone: "neutral" | "primary"
  count: number
  caption: string
  emptyMessage: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <header
        className={cn(
          "border-b px-4 py-3",
          tone === "primary" ? "border-b-primary/20 bg-primary/[0.07]" : "bg-muted/40",
        )}
      >
        <div className="flex items-center gap-2">
          <Icon
            className={cn("size-4 shrink-0", tone === "primary" ? "text-primary" : "text-muted-foreground")}
            aria-hidden
          />
          <h3 className={cn("text-sm font-semibold", tone === "primary" && "text-primary")}>{title}</h3>
          <Badge
            variant={tone === "primary" ? "default" : "secondary"}
            className="ml-auto h-5 px-2 text-[11px] font-semibold tabular-nums"
          >
            {count}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </header>
      <div className="px-4 py-1">
        {count === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

/**
 * Tab "Jam Kosong Guru".
 *
 * Namanya disengaja: tidak adanya jadwal mengajar TIDAK berarti guru tersedia
 * untuk tugas lain (piket, rapat, dinas luar tidak terekam modul ini). Karena
 * itu isi tab memakai istilah "Tidak ada jadwal mengajar", bukan "tersedia",
 * dan panelnya TIDAK diberi warna hijau yang terbaca sebagai "bebas".
 *
 * Bila saat ini bukan jam pelajaran, tab tidak berpura-pura punya jawaban: ia
 * menjelaskan keadaan dan meminta pengguna memilih jam pelajaran.
 */
export function FreeTeachersTab({
  days,
  todayDay,
  current,
}: {
  days: readonly ProfileDay[]
  todayDay: ScheduleDay | null
  current: CurrentSlotResult
}) {
  const configured = orderedDays([...days]).filter((item) => item.slots.length > 0)
  const initialDay =
    (todayDay !== null && configured.some((item) => item.day === todayDay)
      ? todayDay
      : configured[0]?.day) ?? 1
  const [day, setDay] = useState<ScheduleDay>(initialDay as ScheduleDay)

  // Jam pelajaran yang boleh dipilih adalah milik HARI TERPILIH. Memakai satu
  // daftar untuk semua hari menawarkan jam yang tidak ada pada hari itu, dan
  // server memang menolaknya.
  const lessons = lessonSlots([...(findProfileDay(configured, day)?.slots ?? [])])

  const [period, setPeriod] = useState<number | null>(
    current.state === "lesson" ? current.period : null,
  )
  const [query, setQuery] = useState("")

  // Berpindah hari tidak boleh menyisakan nomor jam yang tidak dikenal hari itu.
  const periodExists = period !== null && lessons.some((slot) => slot.ascPeriod === period)
  const effectivePeriod = periodExists ? period : null

  const url =
    effectivePeriod === null ? null : `/api/jadwal/jam-kosong?day=${day}&period=${effectivePeriod}`
  const { data, loading, error } = useScheduleResource<Payload>(url)

  // Pencarian memakai penyaring yang sama dengan combobox, sehingga "alam"
  // menemukan "Muhammad Nur Alamsyah" di sini persis seperti di tempat lain.
  const free = data ? filterBySearchQuery(data.free, query, (teacher) => teacher.name) : []
  const teaching = data
    ? filterBySearchQuery(
        data.teaching,
        query,
        (teacher) => `${teacher.name} ${teacher.className} ${teacher.subjectName}`,
      )
    : []

  return (
    <div className="space-y-4">
      {current.state !== "lesson" ? (
        <p className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {current.state === "break"
              ? `Saat ini ${current.slot.name} (${formatTimeRange(current.slot.startMinute, current.slot.endMinute)}) — bukan jam pelajaran.`
              : "Saat ini di luar jam pelajaran."}{" "}
            Pilih hari dan jam pelajaran untuk melihat guru yang tidak memiliki jadwal mengajar pada jam
            tersebut.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[12rem]">
          <Label htmlFor="jam-kosong-hari" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" aria-hidden />
            Hari
          </Label>
          <Select value={String(day)} onValueChange={(value) => value && setDay(Number(value) as ScheduleDay)}>
            <SelectTrigger id="jam-kosong-hari" className="w-full">
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

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[15rem]">
          <Label htmlFor="jam-kosong-jam" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden />
            Jam pelajaran
          </Label>
          <Select
            value={effectivePeriod === null ? "" : String(effectivePeriod)}
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

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[16rem]">
          <Label htmlFor="jam-kosong-cari" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Search className="size-3.5" aria-hidden />
            Cari guru
          </Label>
          <Input
            id="jam-kosong-cari"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ketik sebagian nama"
            disabled={effectivePeriod === null}
            autoComplete="off"
          />
        </div>
      </div>

      {effectivePeriod === null ? (
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
          <TeacherPanel
            title="Tidak ada jadwal mengajar"
            icon={CircleMinus}
            tone="neutral"
            count={free.length}
            caption={`${SCHEDULE_DAY_LABELS[data.day as ScheduleDay]} · ${data.slot.name} · ${formatTimeRange(data.slot.startMinute, data.slot.endMinute)}. Tidak ada jadwal mengajar bukan jaminan guru bebas tugas.`}
            emptyMessage={
              query
                ? "Tidak ada nama yang cocok dengan pencarian."
                : data.totalTeachers === 0
                  ? "Belum ada guru yang memenuhi syarat modul Jadwal."
                  : "Seluruh guru memiliki jadwal mengajar pada jam ini."
            }
          >
            <ul className="divide-y divide-border/50">
              {free.map((teacher) => (
                <li
                  key={teacher.id}
                  className="rounded-md px-1 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-muted/50"
                >
                  {teacher.name}
                </li>
              ))}
            </ul>
          </TeacherPanel>

          <TeacherPanel
            title="Sedang mengajar"
            icon={BookOpenCheck}
            tone="primary"
            count={teaching.length}
            caption={`Dari ${data.totalTeachers} guru pada populasi modul Jadwal.`}
            emptyMessage={
              query
                ? "Tidak ada nama yang cocok dengan pencarian."
                : "Belum ada jadwal mengajar pada jam ini."
            }
          >
            <ul className="divide-y divide-border/50">
              {teaching.map((teacher) => (
                <li
                  key={teacher.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md px-1 py-2.5 transition-colors duration-150 hover:bg-muted/50"
                >
                  {/* Nama panjang membungkus, tidak mendorong keterangan keluar. */}
                  <span className="min-w-0 text-sm font-medium">{teacher.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {teacher.className} · {teacher.subjectName}
                  </span>
                </li>
              ))}
            </ul>
          </TeacherPanel>
        </div>
      ) : null}
    </div>
  )
}

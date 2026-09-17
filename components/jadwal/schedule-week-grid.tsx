"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  SCHEDULE_DAY_LABELS,
  SCHEDULE_DAY_SHORT_LABELS,
  formatTimeRange,
  scheduleDayLabel,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { orderedDays, orderedSlots } from "@/lib/schedule-time"
import type { ProfileDay, TimeSlot } from "@/lib/schedule-time"
import type { ScheduleEntryView } from "@/lib/server-schedule"
import { cn } from "@/lib/utils"

/**
 * Baris timeline: satu slot struktur waktu, plus entri jadwal bila slot itu
 * memang jam pelajaran.
 *
 * Istirahat/kegiatan ikut ditampilkan justru karena jadwal tanpa jeda terbaca
 * seperti mengajar tanpa henti — strukturnya diambil dari Waktu & Kegiatan,
 * bukan dari berkas aSc.
 */
function entryFor(entries: readonly ScheduleEntryView[], day: number, period: number | null) {
  if (period === null) return null
  return entries.find((entry) => entry.day === day && entry.period === period) ?? null
}

function SlotCell({
  slot,
  entry,
  emphasis,
  showTeacher,
  showClass,
}: {
  slot: TimeSlot
  entry: ScheduleEntryView | null
  emphasis?: boolean
  showTeacher?: boolean
  showClass?: boolean
}) {
  if (slot.kind !== "PELAJARAN") {
    return <span className="text-xs text-muted-foreground">{slot.name}</span>
  }

  if (!entry) return <span className="text-xs text-muted-foreground/60">—</span>

  return (
    <div className={cn("space-y-0.5", emphasis && "font-medium")}>
      <p className="text-sm leading-tight">{entry.subjectName}</p>
      {showClass ? <p className="text-xs text-muted-foreground">{entry.className}</p> : null}
      {showTeacher ? (
        <p className="text-xs text-muted-foreground">{entry.teacherName ?? "Guru belum ditetapkan"}</p>
      ) : null}
      {entry.room ? <p className="text-xs text-muted-foreground">Ruang {entry.room}</p> : null}
    </div>
  )
}

/**
 * Jadwal satu pekan.
 *
 * Setiap hari membawa STRUKTUR WAKTUNYA SENDIRI (`ProfileDay.slots`).
 * Tampilan ini sengaja tidak lagi menerima satu daftar slot tunggal: struktur
 * waktu Senin tidak berlaku untuk Jumat, dan memakai satu daftar untuk semua
 * kolom membuat setiap hari tampak seperti Senin — termasuk upacara dan
 * istirahat yang sebenarnya hanya ada pada hari tertentu.
 *
 * Kolom hari juga dibaca dari data, bukan dari daftar hari tetap, supaya profil
 * yang menambah/mengurangi hari aktif tetap tampil apa adanya.
 *
 * Desktop memakai satu kolom per hari; mobile TIDAK memaksakan grid selebar itu
 * — hari menjadi chip dan slot menjadi daftar vertikal.
 */
export function ScheduleWeekGrid({
  days,
  entries,
  highlightDay,
  showTeacher = false,
  showClass = true,
}: {
  days: readonly ProfileDay[]
  entries: readonly ScheduleEntryView[]
  highlightDay: ScheduleDay | null
  showTeacher?: boolean
  showClass?: boolean
}) {
  const ordered = useMemo(
    () =>
      orderedDays([...days]).map((item) => ({
        ...item,
        slots: orderedSlots([...item.slots]),
      })),
    [days],
  )

  const configured = useMemo(() => ordered.filter((item) => item.slots.length > 0), [ordered])

  const [mobileDay, setMobileDay] = useState<number>(
    () =>
      (highlightDay !== null && configured.some((item) => item.day === highlightDay)
        ? highlightDay
        : configured[0]?.day) ?? 1,
  )

  if (configured.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Struktur waktu belum disusun. Buka tab “Waktu &amp; Kegiatan” untuk menyusunnya.
      </p>
    )
  }

  const activeMobile = configured.find((item) => item.day === mobileDay) ?? configured[0]

  return (
    <div className="space-y-4">
      {/* Mobile: hari sebagai chip, hari ini aktif secara bawaan. */}
      <div className="flex flex-wrap gap-2 lg:hidden">
        {configured.map((item) => (
          <button
            key={item.day}
            type="button"
            onClick={() => setMobileDay(item.day)}
            aria-pressed={activeMobile.day === item.day}
            className={cn(
              "min-h-9 rounded-full border px-3 text-sm transition-colors",
              activeMobile.day === item.day
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {SCHEDULE_DAY_SHORT_LABELS[item.day as ScheduleDay] ?? scheduleDayLabel(item.day)}
            {highlightDay === item.day ? <span className="ml-1 text-[10px]">•</span> : null}
          </button>
        ))}
      </div>

      <div className="space-y-2 lg:hidden">
        {activeMobile.slots.map((slot) => {
          const entry = entryFor(entries, activeMobile.day, slot.ascPeriod)
          if (slot.kind !== "PELAJARAN" && !entry) {
            return (
              <div key={slot.id} className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {formatTimeRange(slot.startMinute, slot.endMinute)} · {slot.name}
              </div>
            )
          }
          return (
            <Card key={slot.id} className="border-border/70">
              <CardContent className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {slot.name} · {formatTimeRange(slot.startMinute, slot.endMinute)}
                  </p>
                  <div className="mt-1">
                    <SlotCell slot={slot} entry={entry} showTeacher={showTeacher} showClass={showClass} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Desktop: satu kolom per hari, masing-masing memakai jamnya sendiri. */}
      <div
        className="hidden gap-3 overflow-x-auto lg:grid"
        style={{ gridTemplateColumns: `repeat(${configured.length}, minmax(0, 1fr))` }}
      >
        {configured.map((item) => (
          <section
            key={item.day}
            className={cn(
              "rounded-xl border border-border/60",
              highlightDay === item.day && "border-primary/50 bg-primary/5",
            )}
          >
            <header className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
              <h3 className={cn("text-sm font-semibold", highlightDay === item.day && "text-primary")}>
                {SCHEDULE_DAY_LABELS[item.day as ScheduleDay] ?? scheduleDayLabel(item.day)}
              </h3>
              {highlightDay === item.day ? <Badge variant="secondary">Hari ini</Badge> : null}
            </header>

            <ul className="divide-y">
              {item.slots.map((slot) => (
                <li
                  key={slot.id}
                  className={cn("px-3 py-2", slot.kind !== "PELAJARAN" && "bg-muted/30")}
                >
                  <p className="text-xs text-muted-foreground">
                    {slot.name} · {formatTimeRange(slot.startMinute, slot.endMinute)}
                  </p>
                  <div className="mt-1">
                    <SlotCell
                      slot={slot}
                      entry={entryFor(entries, item.day, slot.ascPeriod)}
                      emphasis={highlightDay === item.day}
                      showTeacher={showTeacher}
                      showClass={showClass}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

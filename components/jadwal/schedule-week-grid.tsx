"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  SCHEDULE_DAY_LABELS,
  SCHEDULE_DAY_SHORT_LABELS,
  SCHEDULE_DAYS,
  formatTimeRange,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { orderedSlots } from "@/lib/schedule-time"
import type { TimeSlot } from "@/lib/schedule-time"
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
 * Desktop memakai tabel Jam × Hari; mobile TIDAK memaksakan grid enam kolom —
 * hari menjadi chip dan slot menjadi daftar vertikal, karena tabel selebar itu
 * hanya bisa dibaca dengan menggeser layar ke samping.
 */
export function ScheduleWeekGrid({
  slots,
  entries,
  highlightDay,
  showTeacher = false,
  showClass = true,
}: {
  slots: readonly TimeSlot[]
  entries: readonly ScheduleEntryView[]
  highlightDay: ScheduleDay | null
  showTeacher?: boolean
  showClass?: boolean
}) {
  const ordered = useMemo(() => orderedSlots([...slots]), [slots])
  const [mobileDay, setMobileDay] = useState<ScheduleDay>(highlightDay ?? 1)

  if (ordered.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Struktur waktu belum disusun. Buka tab “Waktu & Kegiatan” untuk menyusunnya.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mobile: hari sebagai chip, hari ini aktif secara bawaan. */}
      <div className="flex flex-wrap gap-2 lg:hidden">
        {SCHEDULE_DAYS.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => setMobileDay(day)}
            aria-pressed={mobileDay === day}
            className={cn(
              "min-h-9 rounded-full border px-3 text-sm transition-colors",
              mobileDay === day
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {SCHEDULE_DAY_SHORT_LABELS[day]}
            {highlightDay === day ? <span className="ml-1 text-[10px]">•</span> : null}
          </button>
        ))}
      </div>

      <div className="space-y-2 lg:hidden">
        {ordered.map((slot) => {
          const entry = entryFor(entries, mobileDay, slot.ascPeriod)
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

      {/* Desktop: satu pandangan penuh satu pekan. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border/60 lg:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <tr>
              <th className="w-44 border-b px-3 py-2 text-left font-semibold">Jam</th>
              {SCHEDULE_DAYS.map((day) => (
                <th
                  key={day}
                  className={cn(
                    "border-b px-3 py-2 text-left font-semibold",
                    highlightDay === day && "text-primary",
                  )}
                >
                  {SCHEDULE_DAY_LABELS[day]}
                  {highlightDay === day ? (
                    <Badge variant="secondary" className="ml-2 align-middle">
                      Hari ini
                    </Badge>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((slot) => (
              <tr key={slot.id} className={cn(slot.kind !== "PELAJARAN" && "bg-muted/30")}>
                <th scope="row" className="border-b px-3 py-2 text-left align-top font-medium">
                  <span className="block">{slot.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {formatTimeRange(slot.startMinute, slot.endMinute)}
                  </span>
                </th>
                {slot.kind !== "PELAJARAN" ? (
                  <td className="border-b px-3 py-2 text-xs text-muted-foreground" colSpan={SCHEDULE_DAYS.length}>
                    {slot.name}
                  </td>
                ) : (
                  SCHEDULE_DAYS.map((day) => (
                    <td
                      key={day}
                      className={cn("border-b px-3 py-2 align-top", highlightDay === day && "bg-primary/5")}
                    >
                      <SlotCell
                        slot={slot}
                        entry={entryFor(entries, day, slot.ascPeriod)}
                        emphasis={highlightDay === day}
                        showTeacher={showTeacher}
                        showClass={showClass}
                      />
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

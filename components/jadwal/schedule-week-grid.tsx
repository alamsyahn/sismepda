"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import {
  SCHEDULE_DAY_LABELS,
  SCHEDULE_DAY_SHORT_LABELS,
  formatTimeRange,
  scheduleDayLabel,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { orderedDays, orderedSlots } from "@/lib/schedule-time"
import type { CurrentSlotResult, ProfileDay, TimeSlot } from "@/lib/schedule-time"
import { SLOT_TONE_CLASS, isCurrentSlot, slotKindLabel, slotTone } from "@/lib/schedule-presentation"
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

/**
 * Isi satu slot.
 *
 * Hierarki sengaja dibalik dari versi lama: mata pelajaran menjadi teks paling
 * menonjol, sedangkan jam/waktu turun menjadi baris kecil yang teredam. Yang
 * dicari mata saat memindai jadwal adalah "mengajar apa", bukan "jam ke
 * berapa" — nomor jam hanya penunjuk posisi.
 */
function SlotBody({
  slot,
  entry,
  showTeacher,
  showClass,
}: {
  slot: TimeSlot
  entry: ScheduleEntryView | null
  showTeacher?: boolean
  showClass?: boolean
}) {
  if (slot.kind !== "PELAJARAN") {
    // Nama kegiatan tetap ditulis apa adanya — "Upacara Bendera" lebih berguna
    // daripada label generik, dan warna saja tidak boleh jadi satu-satunya
    // penanda jenis baris.
    return <p className="text-sm leading-tight font-medium text-foreground/80">{slotKindLabel(slot)}</p>
  }

  if (!entry) {
    return <p className="text-sm leading-tight text-muted-foreground/70">Tidak ada jadwal</p>
  }

  return (
    <div className="space-y-1">
      <p className="text-sm leading-tight font-semibold text-foreground">{entry.subjectName}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {showClass ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-medium">
            {entry.className}
          </Badge>
        ) : null}
        {showTeacher ? (
          <span className="text-xs text-muted-foreground">
            {entry.teacherName ?? "Guru belum ditetapkan"}
          </span>
        ) : null}
        {entry.room ? <span className="text-xs text-muted-foreground">Ruang {entry.room}</span> : null}
      </div>
    </div>
  )
}

/** Baris "Jam ke-X · 07.45–08.25" plus penanda sedang berlangsung. */
function SlotMeta({ slot, isNow }: { slot: TimeSlot; isNow: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <p className="text-xs text-muted-foreground">
        {slot.name} · {formatTimeRange(slot.startMinute, slot.endMinute)}
      </p>
      {isNow ? (
        <Badge className="h-4 px-1.5 text-[10px] font-semibold tracking-wide uppercase">Sekarang</Badge>
      ) : null}
    </div>
  )
}

/**
 * Jadwal satu pekan.
 *
 * Setiap hari membawa STRUKTUR WAKTUNYA SENDIRI (`ProfileDay.slots`).
 * Tampilan ini sengaja tidak menerima satu daftar slot tunggal: struktur waktu
 * Senin tidak berlaku untuk Jumat, dan memakai satu daftar untuk semua kolom
 * membuat setiap hari tampak seperti Senin — termasuk upacara dan istirahat
 * yang sebenarnya hanya ada pada hari tertentu.
 *
 * Kolom hari dibaca dari data, bukan dari daftar hari tetap, supaya profil yang
 * menambah/mengurangi hari aktif tetap tampil apa adanya.
 *
 * Desktop memakai satu kolom per hari dengan lebar minimum yang layak: bila
 * viewport sempit, papan MENGGESER mendatar alih-alih memeras kolom sampai
 * nama mapel terpotong. Mobile tidak memaksakan grid selebar itu — hari menjadi
 * chip dan slot menjadi daftar vertikal.
 */
export function ScheduleWeekGrid({
  days,
  entries,
  highlightDay,
  current,
  showTeacher = false,
  showClass = true,
}: {
  days: readonly ProfileDay[]
  entries: readonly ScheduleEntryView[]
  highlightDay: ScheduleDay | null
  /** Konteks "sekarang" dari server; tanpa ini tidak ada badge "Sekarang". */
  current?: CurrentSlotResult
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
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Struktur waktu belum disusun. Buka tab “Waktu &amp; Kegiatan” untuk menyusunnya.
      </p>
    )
  }

  const activeMobile = configured.find((item) => item.day === mobileDay) ?? configured[0]

  /** Satu baris slot, dipakai kolom desktop maupun daftar mobile. */
  const renderSlot = (item: (typeof configured)[number], slot: TimeSlot) => {
    const entry = entryFor(entries, item.day, slot.ascPeriod)
    const tone = slotTone(slot, entry !== null)
    const isToday = highlightDay === item.day
    const isNow = current ? isCurrentSlot(current, slot, isToday) : false

    return (
      <li
        key={slot.id}
        className={cn(
          "px-3 py-2.5 transition-colors duration-150",
          SLOT_TONE_CLASS[tone],
          // Jam berjalan diberi garis kiri, bukan latar mencolok: penanda tetap
          // terbaca walau slotnya sudah punya tint istirahat/kegiatan.
          isNow && "border-l-2 border-l-primary bg-primary/[0.06]",
        )}
        aria-current={isNow ? "time" : undefined}
      >
        <SlotMeta slot={slot} isNow={isNow} />
        <div className="mt-1">
          <SlotBody slot={slot} entry={entry} showTeacher={showTeacher} showClass={showClass} />
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mobile: hari sebagai chip, hari ini aktif secara bawaan. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
        {configured.map((item) => {
          const active = activeMobile.day === item.day
          return (
            <button
              key={item.day}
              type="button"
              onClick={() => setMobileDay(item.day)}
              aria-pressed={active}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm",
                "transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {SCHEDULE_DAY_SHORT_LABELS[item.day as ScheduleDay] ?? scheduleDayLabel(item.day)}
              {highlightDay === item.day ? (
                <span
                  className={cn("size-1.5 rounded-full", active ? "bg-primary-foreground" : "bg-primary")}
                  aria-hidden
                />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-border/60 lg:hidden">
        <header
          className={cn(
            "flex items-center gap-2 rounded-t-xl border-b px-3 py-2.5",
            highlightDay === activeMobile.day ? "bg-primary/[0.07]" : "bg-muted/40",
          )}
        >
          <h3
            className={cn(
              "text-sm font-semibold",
              highlightDay === activeMobile.day && "text-primary",
            )}
          >
            {SCHEDULE_DAY_LABELS[activeMobile.day as ScheduleDay] ?? scheduleDayLabel(activeMobile.day)}
          </h3>
          {highlightDay === activeMobile.day ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
              Hari ini
            </Badge>
          ) : null}
        </header>
        <ul className="divide-y divide-border/50">
          {activeMobile.slots.map((slot) => renderSlot(activeMobile, slot))}
        </ul>
      </div>

      {/* Desktop: satu kolom per hari, masing-masing memakai jamnya sendiri. */}
      <div className="-mx-1 hidden overflow-x-auto px-1 pb-1 lg:block">
        <div
          className="grid gap-2.5"
          style={{
            // minmax menjaga kolom tetap terbaca; bila total melebihi layar,
            // pembungkusnya yang menggeser, bukan teks yang menyempit.
            gridTemplateColumns: `repeat(${configured.length}, minmax(11rem, 1fr))`,
          }}
        >
          {configured.map((item) => {
            const isToday = highlightDay === item.day
            return (
              <section
                key={item.day}
                className={cn(
                  "overflow-hidden rounded-xl border bg-card",
                  isToday ? "border-primary/40" : "border-border/60",
                )}
              >
                <header
                  className={cn(
                    "flex items-center justify-between gap-2 border-b px-3 py-2.5",
                    isToday ? "border-b-primary/20 bg-primary/[0.07]" : "bg-muted/40",
                  )}
                >
                  <h3 className={cn("text-sm font-semibold", isToday && "text-primary")}>
                    {SCHEDULE_DAY_LABELS[item.day as ScheduleDay] ?? scheduleDayLabel(item.day)}
                  </h3>
                  {isToday ? (
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px]">
                      Hari ini
                    </Badge>
                  ) : null}
                </header>

                <ul className="divide-y divide-border/50">
                  {item.slots.map((slot) => renderSlot(item, slot))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

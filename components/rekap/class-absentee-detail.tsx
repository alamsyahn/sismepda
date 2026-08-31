"use client"

import { useId, useState } from "react"
import { ChevronDown, UserCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { statusMeta, type AbsentStudent } from "@/lib/dashboard-data"
import {
  ABSENT_STATUS_ORDER,
  absenteeSummaryLabel,
  countAbsenteesByStatus,
  groupAbsentees,
  repeatedAbsenceLabel,
  type AbsentStatus,
} from "@/lib/class-absentees"
import { ProfileNameLink } from "@/components/profile/profile-name-link"

type OpenState = AbsentStatus | "all" | null

/**
 * Rincian siswa tidak hadir untuk satu kelas, tampil di dalam kartu yang sama.
 * Tidak ada perpindahan halaman maupun tab: pengguna menekan pil status dan
 * daftar namanya terbuka tepat di bawahnya.
 */
export function ClassAbsenteeDetail({
  className,
  students,
  hadir,
  totalStudents,
}: {
  className: string
  students: AbsentStudent[]
  hadir: number
  totalStudents: number
}) {
  const [open, setOpen] = useState<OpenState>(null)
  const panelId = useId()
  const counts = countAbsenteesByStatus(students)
  const visible = open === null ? [] : open === "all" ? students : students.filter((s) => s.status === open)
  const groups = groupAbsentees(visible)

  function toggle(next: Exclude<OpenState, null>) {
    setOpen((current) => (current === next ? null : next))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Kehadiran</span>
        <span className="text-sm font-semibold">
          {hadir}/{totalStudents} siswa
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", statusMeta.hadir.badge)}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: statusMeta.hadir.token }} />
          {statusMeta.hadir.label}
          <span className="font-semibold">{hadir}</span>
        </span>

        {ABSENT_STATUS_ORDER.map((status) => {
          const count = counts[status]
          const meta = statusMeta[status]
          const active = open === status
          const disabled = count === 0
          return (
            <button
              key={status}
              type="button"
              disabled={disabled}
              aria-expanded={active}
              aria-controls={active ? panelId : undefined}
              onClick={() => toggle(status)}
              title={disabled ? `Tidak ada siswa ${meta.label.toLowerCase()}` : `Lihat siswa ${meta.label.toLowerCase()} di ${className}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                meta.badge,
                disabled
                  ? "cursor-default opacity-45"
                  : "cursor-pointer hover:brightness-95 dark:hover:brightness-125",
                active && "ring-2 ring-current/40",
              )}
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.token }} />
              {meta.label}
              <span className="font-semibold">{count}</span>
              {disabled ? null : (
                <ChevronDown className={cn("size-3 transition-transform", active && "rotate-180")} />
              )}
            </button>
          )
        })}
      </div>

      {students.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg bg-[var(--chart-1)]/8 px-3 py-2 text-xs font-medium text-[var(--chart-1)]">
          <UserCheck className="size-3.5" />
          {absenteeSummaryLabel(students)}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => toggle("all")}
          aria-expanded={open === "all"}
          aria-controls={open === "all" ? panelId : undefined}
          className="flex w-full items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {absenteeSummaryLabel(students)}
          <span className="flex items-center gap-1 text-muted-foreground">
            {open === "all" ? "Tutup" : "Lihat semua"}
            <ChevronDown className={cn("size-3.5 transition-transform", open === "all" && "rotate-180")} />
          </span>
        </button>
      )}

      {open !== null && groups.length > 0 ? (
        <div
          id={panelId}
          className="space-y-3 rounded-xl border border-border/70 bg-muted/40 p-3"
          role="region"
          aria-label={`Rincian siswa tidak hadir ${className}`}
        >
          {groups.map((group) => (
            <div key={group.status} className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: statusMeta[group.status].token }} />
                {group.label}
                <span className="tabular-nums">({group.students.length})</span>
              </p>
              <ul className="space-y-1">
                {group.students.map((student) => {
                  const repeated = repeatedAbsenceLabel(student)
                  return (
                    <li
                      key={student.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg bg-card px-2.5 py-1.5"
                    >
                      <ProfileNameLink
                        type="student"
                        id={student.id}
                        name={student.name}
                        className="text-sm font-medium text-foreground"
                      />
                      <span className="text-xs text-muted-foreground">
                        {student.note && student.note !== "-" ? student.note : "Tanpa keterangan"}
                      </span>
                      {repeated ? (
                        <span className="w-full text-[11px] text-muted-foreground">{repeated}</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

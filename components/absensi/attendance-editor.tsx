"use client"

import { useRef } from "react"

import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusRadioGroup, type StatusOption } from "@/components/absensi/status-toggle"
import { ProfileNameLink } from "@/components/profile/profile-name-link"
import {
  ABSENCE_REASONS,
  PRIMARY_STATUS_ORDER,
  absenceNoteCopy,
  inputStatusConfig,
  isAbsenceReason,
  isNoteMissing,
  primaryStatusConfig,
  primaryStatusOf,
  type AbsenceReason,
  type InputStatus,
  type PrimaryStatus,
  type RosterStudent,
} from "@/lib/attendance-input"
import { cn } from "@/lib/utils"

const PRIMARY_OPTIONS: StatusOption<PrimaryStatus>[] = PRIMARY_STATUS_ORDER.map((value) => ({
  value,
  config: primaryStatusConfig[value],
}))

const REASON_OPTIONS: StatusOption<AbsenceReason>[] = ABSENCE_REASONS.map((value) => ({
  value,
  config: inputStatusConfig[value],
}))

export type NoteInputVariant = "desktop" | "mobile"

type EditorProps = {
  roster: RosterStudent[]
  statuses: Record<string, InputStatus>
  notes: Record<string, string>
  /** Siswa yang field keterangannya sudah pernah kehilangan fokus dalam keadaan kosong. */
  touched: Record<string, boolean>
  /** Diaktifkan setelah pengguna menekan Simpan dengan keterangan wajib kosong. */
  showAllErrors: boolean
  /**
   * Siswa yang sudah dipilih "Tidak Hadir" tetapi belum memilih alasan.
   * Statusnya tetap "belum" sampai alasan dipilih, sehingga tidak ada nilai
   * ketidakhadiran yang terkirim tanpa dipilih pengguna.
   */
  absentPending: Record<string, boolean>
  onPrimary: (studentId: string, primary: PrimaryStatus) => void
  onStatus: (studentId: string, status: InputStatus) => void
  onNote: (studentId: string, note: string) => void
  onNoteBlur: (studentId: string) => void
  registerNoteInput: (
    studentId: string,
    variant: NoteInputVariant,
    element: HTMLInputElement | null,
  ) => void
}

export function AttendanceEditor(props: EditorProps) {
  return (
    <>
      <DesktopTable {...props} />
      <MobileCards {...props} />
    </>
  )
}

/**
 * Semua state keterangan satu siswa dalam satu tempat: apakah field ditampilkan,
 * teks kontekstualnya, dan apakah error sudah boleh muncul.
 */
function useNoteState(
  studentId: string,
  status: InputStatus,
  { notes, touched, showAllErrors }: Pick<EditorProps, "notes" | "touched" | "showAllErrors">,
) {
  const reason = isAbsenceReason(status) ? status : null
  const missing = isNoteMissing(status, notes[studentId])
  // Error tidak langsung merah begitu alasan dipilih: hanya setelah blur dalam
  // keadaan kosong, atau setelah pengguna mencoba menyimpan.
  const showError = missing && (Boolean(touched[studentId]) || showAllErrors)
  return { reason, showError, copy: reason ? absenceNoteCopy[reason] : null }
}

type RowProps = EditorProps & { student: RosterStudent }

function useRowHandlers({ student, statuses, absentPending, onPrimary, onStatus }: RowProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const status = statuses[student.id] ?? "belum"
  const primary: PrimaryStatus = absentPending[student.id] ? "tidakHadir" : primaryStatusOf(status)

  const handlePrimary = (next: PrimaryStatus) => {
    if (next === primary) return
    onPrimary(student.id, next)
  }

  const handleReason = (reason: AbsenceReason) => {
    onStatus(student.id, reason)
    // Setelah alasan dipilih pengguna langsung bisa mengetik keterangannya.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return { inputRef, status, primary, handlePrimary, handleReason }
}

function DesktopTable(props: EditorProps) {
  const { roster } = props
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm lg:block">
      <Table>
        <colgroup>
          <col style={{ width: "56px" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "20%" }} />
          <col />
          <col style={{ width: "24%" }} />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-12 text-center">No.</TableHead>
            <TableHead className="h-12">NIS</TableHead>
            <TableHead className="h-12">Nama Lengkap Siswa</TableHead>
            <TableHead className="h-12">Status Kehadiran</TableHead>
            <TableHead className="h-12">Keterangan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roster.map((student) => (
            <DesktopRow key={student.id} {...props} student={student} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function DesktopRow(props: RowProps) {
  const { student, onNote, onNoteBlur, registerNoteInput, notes } = props
  const { inputRef, status, primary, handlePrimary, handleReason } = useRowHandlers(props)
  const { reason, showError, copy } = useNoteState(student.id, status, props)
  const errorId = `keterangan-error-${student.id}`

  return (
    <TableRow className="align-top">
      <TableCell className="py-3 text-center font-medium tabular-nums text-muted-foreground">
        {String(student.no).padStart(2, "0")}
      </TableCell>
      <TableCell className="py-3 font-mono text-sm text-muted-foreground">{student.nis ?? "-"}</TableCell>
      <TableCell className="py-3 font-medium text-foreground">
        <ProfileNameLink type="student" id={student.id} name={student.name} />
      </TableCell>
      <TableCell className="py-3">
        <div className="space-y-1.5">
          <StatusRadioGroup
            options={PRIMARY_OPTIONS}
            value={primary}
            onChange={handlePrimary}
            label={`Status kehadiran ${student.name}`}
          />
          {primary === "tidakHadir" ? (
            <StatusRadioGroup
              options={REASON_OPTIONS}
              value={reason}
              onChange={handleReason}
              label={`Alasan ketidakhadiran ${student.name}`}
            />
          ) : null}
        </div>
      </TableCell>
      <TableCell className="py-3">
        {primary === "tidakHadir" && copy ? (
          <div className="space-y-1">
            <label
              htmlFor={`keterangan-desktop-${student.id}`}
              className="block text-xs font-medium text-foreground"
            >
              {copy.label} <span aria-hidden>*</span>
              <span className="sr-only">(wajib diisi)</span>
            </label>
            <Input
              id={`keterangan-desktop-${student.id}`}
              ref={(element) => {
                inputRef.current = element
                registerNoteInput(student.id, "desktop", element)
              }}
              value={notes[student.id] ?? ""}
              onChange={(event) => onNote(student.id, event.target.value)}
              onBlur={() => onNoteBlur(student.id)}
              placeholder={copy.placeholder}
              aria-required
              aria-invalid={showError || undefined}
              aria-describedby={errorId}
              className={cn(showError && "border-destructive focus-visible:ring-destructive/40")}
            />
            <p
              id={errorId}
              className={cn("text-xs", showError ? "font-medium text-destructive" : "text-muted-foreground")}
            >
              {showError ? copy.error : "Wajib diisi"}
            </p>
          </div>
        ) : primary === "tidakHadir" ? (
          <p className="text-xs text-muted-foreground">Pilih alasan ketidakhadiran terlebih dahulu.</p>
        ) : (
          <span className="text-sm text-muted-foreground" aria-label="Tidak perlu keterangan">
            —
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}

function MobileCards(props: EditorProps) {
  const { roster } = props
  return (
    <div className="space-y-3 lg:hidden">
      {roster.map((student) => (
        <MobileCard key={student.id} {...props} student={student} />
      ))}
    </div>
  )
}

function MobileCard(props: RowProps) {
  const { student, onNote, onNoteBlur, registerNoteInput, notes } = props
  const { inputRef, status, primary, handlePrimary, handleReason } = useRowHandlers(props)
  const { reason, showError, copy } = useNoteState(student.id, status, props)
  const errorId = `keterangan-error-mobile-${student.id}`

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {String(student.no).padStart(2, "0")}
        </span>
        <span className="font-semibold text-foreground text-pretty">
          <ProfileNameLink type="student" id={student.id} name={student.name} />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        NIS <span className="font-mono">{student.nis ?? "-"}</span>
      </p>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Status Kehadiran</p>
        <StatusRadioGroup
          options={PRIMARY_OPTIONS}
          value={primary}
          onChange={handlePrimary}
          label={`Status kehadiran ${student.name}`}
          className="grid grid-cols-3 gap-2"
          optionClassName="min-h-11 w-full px-1.5 text-[11px] sm:text-xs"
        />
      </div>

      {primary === "tidakHadir" ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Alasan ketidakhadiran</p>
          <StatusRadioGroup
            options={REASON_OPTIONS}
            value={reason}
            onChange={handleReason}
            label={`Alasan ketidakhadiran ${student.name}`}
            className="grid grid-cols-2 gap-2"
            optionClassName="min-h-11 w-full px-1.5 text-[11px] sm:text-xs"
          />
        </div>
      ) : null}

      {primary === "tidakHadir" && copy ? (
        <div className="space-y-1">
          <label
            htmlFor={`keterangan-mobile-${student.id}`}
            className="block text-xs font-medium text-foreground"
          >
            {copy.label} <span aria-hidden>*</span>
            <span className="sr-only">(wajib diisi)</span>
          </label>
          <Input
            id={`keterangan-mobile-${student.id}`}
            ref={(element) => {
              inputRef.current = element
              registerNoteInput(student.id, "mobile", element)
            }}
            value={notes[student.id] ?? ""}
            onChange={(event) => onNote(student.id, event.target.value)}
            onBlur={() => onNoteBlur(student.id)}
            placeholder={copy.placeholder}
            aria-required
            aria-invalid={showError || undefined}
            aria-describedby={errorId}
            className={cn("min-h-11", showError && "border-destructive focus-visible:ring-destructive/40")}
          />
          <p
            id={errorId}
            className={cn("text-xs", showError ? "font-medium text-destructive" : "text-muted-foreground")}
          >
            {showError ? copy.error : "Wajib diisi"}
          </p>
        </div>
      ) : null}
    </div>
  )
}

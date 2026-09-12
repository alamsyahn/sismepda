"use client"

import { useRef } from "react"
import { Check, Pencil } from "lucide-react"

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
  /**
   * Keterangan yang sudah diselesaikan secara LOKAL: ditampilkan sebagai
   * ringkasan read-only. Belum tersimpan ke database, jadi labelnya tidak boleh
   * menyebut "Tersimpan".
   */
  finalized: Record<string, boolean>
  onPrimary: (studentId: string, primary: PrimaryStatus) => void
  onStatus: (studentId: string, status: InputStatus) => void
  onNote: (studentId: string, note: string) => void
  onNoteBlur: (studentId: string) => void
  /** Mengembalikan false jika isian kosong sehingga field tetap dalam mode edit. */
  onNoteFinalize: (studentId: string) => boolean
  onNoteEdit: (studentId: string) => void
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

/**
 * Field keterangan dengan dua mode.
 *
 * Mode edit: input + tombol centang untuk menyelesaikan. Enter dan blur juga
 * menyelesaikan selama isinya valid; isian kosong ditolak, fokus dipertahankan,
 * dan errornya muncul inline.
 *
 * Mode selesai (lokal): ringkasan read-only dengan tombol pensil untuk kembali
 * mengedit. Tidak memakai kata "Tersimpan" karena data baru masuk database
 * setelah tombol Simpan ditekan.
 */
function NoteField({
  studentId,
  variant,
  copy,
  value,
  showError,
  finalized,
  inputRef,
  onNote,
  onNoteBlur,
  onNoteFinalize,
  onNoteEdit,
  registerNoteInput,
}: {
  studentId: string
  variant: NoteInputVariant
  copy: { label: string; placeholder: string; error: string }
  value: string
  showError: boolean
  finalized: boolean
} & Pick<EditorProps, "onNote" | "onNoteBlur" | "onNoteFinalize" | "onNoteEdit" | "registerNoteInput"> & {
    inputRef: React.RefObject<HTMLInputElement | null>
  }) {
  const fieldId = `keterangan-${variant}-${studentId}`
  const errorId = `keterangan-error-${variant}-${studentId}`
  const touchClass = variant === "mobile" ? "min-h-11" : ""

  if (finalized) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{copy.label}</p>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2",
            touchClass,
          )}
        >
          <Check className="size-4 shrink-0 text-[var(--chart-1)]" aria-hidden />
          <span className="min-w-0 flex-1 break-words text-sm text-foreground">{value}</span>
          <button
            type="button"
            onClick={() => {
              onNoteEdit(studentId)
              // rAF berjalan setelah commit, jadi input mode edit sudah terpasang.
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
            aria-label={`Ubah ${copy.label.toLowerCase()}`}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              variant === "mobile" ? "size-9" : "size-7",
            )}
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="block text-xs font-medium text-foreground">
        {copy.label} <span aria-hidden>*</span>
        <span className="sr-only">(wajib diisi)</span>
      </label>
      <div className="flex items-start gap-1.5">
        <Input
          id={fieldId}
          ref={(element) => {
            inputRef.current = element
            registerNoteInput(studentId, variant, element)
          }}
          value={value}
          onChange={(event) => onNote(studentId, event.target.value)}
          onBlur={() => onNoteBlur(studentId)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            // Form ini tidak memakai submit native; Enter berarti "selesai".
            event.preventDefault()
            if (!onNoteFinalize(studentId)) inputRef.current?.focus()
          }}
          placeholder={copy.placeholder}
          // Keyboard mobile menampilkan aksi Done/Selesai jika didukung.
          enterKeyHint="done"
          aria-required
          aria-invalid={showError || undefined}
          aria-describedby={errorId}
          className={cn(
            "min-w-0 flex-1",
            touchClass,
            showError && "border-destructive focus-visible:ring-destructive/40",
          )}
        />
        <button
          type="button"
          // onMouseDown mendahului blur, sehingga klik centang tidak kehilangan
          // fokus input lebih dulu ketika isiannya masih kosong.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!onNoteFinalize(studentId)) inputRef.current?.focus()
          }}
          aria-label={`Selesai mengisi ${copy.label.toLowerCase()}`}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            variant === "mobile" ? "size-11" : "size-9",
          )}
        >
          <Check className="size-4" aria-hidden />
        </button>
      </div>
      <p
        id={errorId}
        className={cn("text-xs", showError ? "font-medium text-destructive" : "text-muted-foreground")}
      >
        {showError ? copy.error : "Wajib diisi"}
      </p>
    </div>
  )
}

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
    // rAF berjalan setelah commit, jadi ref input sudah terpasang meskipun
    // field sebelumnya berada dalam mode ringkasan.
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
  const { student, notes, finalized, onNote, onNoteBlur, onNoteFinalize, onNoteEdit, registerNoteInput } = props
  const { inputRef, status, primary, handlePrimary, handleReason } = useRowHandlers(props)
  const { reason, showError, copy } = useNoteState(student.id, status, props)

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
          <NoteField
            studentId={student.id}
            variant="desktop"
            copy={copy}
            value={notes[student.id] ?? ""}
            showError={showError}
            finalized={Boolean(finalized[student.id])}
            inputRef={inputRef}
            onNote={onNote}
            onNoteBlur={onNoteBlur}
            onNoteFinalize={onNoteFinalize}
            onNoteEdit={onNoteEdit}
            registerNoteInput={registerNoteInput}
          />
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
  const { student, notes, finalized, onNote, onNoteBlur, onNoteFinalize, onNoteEdit, registerNoteInput } = props
  const { inputRef, status, primary, handlePrimary, handleReason } = useRowHandlers(props)
  const { reason, showError, copy } = useNoteState(student.id, status, props)

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
        <NoteField
          studentId={student.id}
          variant="mobile"
          copy={copy}
          value={notes[student.id] ?? ""}
          showError={showError}
          finalized={Boolean(finalized[student.id])}
          inputRef={inputRef}
          onNote={onNote}
          onNoteBlur={onNoteBlur}
          onNoteFinalize={onNoteFinalize}
          onNoteEdit={onNoteEdit}
          registerNoteInput={registerNoteInput}
        />
      ) : null}
    </div>
  )
}

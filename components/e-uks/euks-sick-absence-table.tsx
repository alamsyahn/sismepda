"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Loader2, Pencil, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { streakTone } from "@/lib/sick-streak"
import { cn } from "@/lib/utils"
import type { SickAbsenceRow } from "@/lib/server-euks"

type EditableField = "note" | "followUp"

const FIELD_LABELS: Record<EditableField, string> = {
  note: "Catatan",
  followUp: "Tindak lanjut sekolah",
}

export function EuksSickAbsenceTable({
  rows,
  canEdit,
  studentName,
}: {
  rows: SickAbsenceRow[]
  canEdit: boolean
  /** Diteruskan ke Input Absensi agar pencariannya langsung terisi nama ini. */
  studentName: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const startEdit = (row: SickAbsenceRow, field: EditableField) => {
    if (!canEdit || saving) return
    setEditing({ id: row.id, field })
    setDraft(row[field] ?? "")
  }

  const cancel = () => {
    if (saving) return
    setEditing(null)
    setDraft("")
  }

  const save = async (row: SickAbsenceRow, field: EditableField) => {
    const next = draft.trim()
    if (next === (row[field] ?? "")) {
      cancel()
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`/api/e-uks/sick-absences/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error ?? `Gagal menyimpan ${FIELD_LABELS[field].toLowerCase()}`)
        return
      }
      toast.success(`${FIELD_LABELS[field]} disimpan`)
      setEditing(null)
      setDraft("")
      router.refresh()
    } catch {
      toast.error("Gagal terhubung ke server")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">No</TableHead>
          <TableHead>Tanggal</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Catatan</TableHead>
          <TableHead className="w-32">Berturut-turut</TableHead>
          <TableHead>Tindak Lanjut Sekolah</TableHead>
          <TableHead className="text-right">Edit di Sismepda</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
              Tidak ada ketidakhadiran karena sakit.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => (
            <TableRow key={row.id}>
              <TableCell>{index + 1}</TableCell>
              <TableCell className="whitespace-nowrap">{row.date}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className="border-transparent text-white"
                  // Warna Sakit mengikuti pengaturan global sekolah; nilai
                  // fallback sama dengan token chart yang dipakai bila admin
                  // belum menyesuaikan warna.
                  style={{ backgroundColor: "var(--status-sakit, var(--chart-4))" }}
                >
                  Sakit
                </Badge>
              </TableCell>

              <EditableCell
                row={row}
                field="note"
                canEdit={canEdit}
                editing={editing}
                draft={draft}
                saving={saving}
                onDraftChange={setDraft}
                onStart={startEdit}
                onCancel={cancel}
                onSave={save}
              />

              <TableCell>
                <StreakBadge dayNumber={row.streak} />
              </TableCell>

              <EditableCell
                row={row}
                field="followUp"
                canEdit={canEdit}
                editing={editing}
                draft={draft}
                saving={saving}
                onDraftChange={setDraft}
                onStart={startEdit}
                onCancel={cancel}
                onSave={save}
              />

              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      href={`/absensi/input?classId=${encodeURIComponent(row.classId)}&date=${encodeURIComponent(row.date)}&siswa=${encodeURIComponent(studentName)}`}
                    />
                  }
                >
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

/**
 * Angka pada baris ini adalah hari ke berapa siswa sakit berturut-turut, jadi
 * labelnya ditulis "Hari ke-n" agar tidak terbaca sebagai panjang episode.
 * Hari pertama sengaja tidak diberi warna: itu kejadian biasa, dan mewarnainya
 * membuat baris yang benar-benar perlu perhatian jadi tenggelam.
 */
function StreakBadge({ dayNumber }: { dayNumber: number }) {
  const tone = streakTone(dayNumber)
  const label = `Hari ke-${dayNumber}`
  if (tone === "none") {
    return <span className="text-muted-foreground text-sm">{label}</span>
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500",
      )}
    >
      {label}
    </Badge>
  )
}

function EditableCell({
  row,
  field,
  canEdit,
  editing,
  draft,
  saving,
  onDraftChange,
  onStart,
  onCancel,
  onSave,
}: {
  row: SickAbsenceRow
  field: EditableField
  canEdit: boolean
  editing: { id: string; field: EditableField } | null
  draft: string
  saving: boolean
  onDraftChange: (value: string) => void
  onStart: (row: SickAbsenceRow, field: EditableField) => void
  onCancel: () => void
  onSave: (row: SickAbsenceRow, field: EditableField) => void
}) {
  const isEditing = editing?.id === row.id && editing.field === field
  const value = row[field]

  if (isEditing) {
    return (
      <TableCell>
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={draft}
            disabled={saving}
            maxLength={500}
            aria-label={`${FIELD_LABELS[field]} ${row.date}`}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                onSave(row, field)
              }
              if (event.key === "Escape") {
                event.preventDefault()
                onCancel()
              }
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            disabled={saving}
            aria-label="Simpan"
            onClick={() => onSave(row, field)}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={saving}
            aria-label="Batal"
            onClick={onCancel}
          >
            <X className="size-4" />
          </Button>
        </div>
      </TableCell>
    )
  }

  if (!canEdit) {
    return (
      <TableCell className={cn(!value && "text-muted-foreground")}>{value ?? "-"}</TableCell>
    )
  }

  return (
    <TableCell className="p-0">
      <button
        type="button"
        onClick={() => onStart(row, field)}
        aria-label={`Ubah ${FIELD_LABELS[field].toLowerCase()} ${row.date}`}
        className={cn(
          "group hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
          !value && "text-muted-foreground",
        )}
      >
        <span className="flex-1">{value ?? "-"}</span>
        <Pencil className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </TableCell>
  )
}

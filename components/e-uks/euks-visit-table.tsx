"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { HeartPulse, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EuksVisitDialog, emptyVisitDraft, type VisitDraft } from "@/components/e-uks/euks-visit-dialog"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import { tableRowNumber } from "@/lib/table-row-number"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"
import type { EuksStudentOption } from "@/lib/euks"
import type { EuksVisitRow } from "@/lib/server-euks"

type Props = {
  visits: EuksVisitRow[]
  students: EuksStudentOption[]
  canEdit: boolean
}

/** School dates are stored as @db.Date, so they format in UTC like every other date column. */
function visitDate(value: Date): string {
  return formatSchoolDate(fromPrismaDate(value), { day: "numeric", month: "short", year: "numeric" })
}

function toDraft(visit: EuksVisitRow): VisitDraft {
  return {
    id: visit.id,
    studentId: visit.studentId,
    occurredAt: fromPrismaDate(visit.occurredAt),
    complaint: visit.complaint,
    treatment: visit.treatment,
    followUp: visit.followUp ?? "",
  }
}

export function EuksVisitTable({ visits, students, canEdit }: Props) {
  const { today } = useSchoolTimeZone()
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<VisitDraft>(() => emptyVisitDraft(today()))
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const hasVisits = visits.length > 0

  function openCreate() {
    setDraft(emptyVisitDraft(today()))
    setFormOpen(true)
  }

  function openEdit(visit: EuksVisitRow) {
    if (!canEdit) return
    setDraft(toDraft(visit))
    setFormOpen(true)
  }

  async function remove(visit: EuksVisitRow) {
    if (!canEdit || deletingId) return
    const confirmed = window.confirm(
      `Hapus kunjungan UKS ${visit.studentName} pada ${visitDate(visit.occurredAt)}?`,
    )
    if (!confirmed) return

    setDeletingId(visit.id)
    try {
      const response = await fetch(`/api/e-uks/visits/${visit.id}`, { method: "DELETE" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Kunjungan gagal dihapus")
      toast.success("Kunjungan UKS dihapus")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunjungan gagal dihapus")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="size-4" />
            Input Kunjungan
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">No</TableHead>
                  <TableHead className="min-w-32">Tanggal</TableHead>
                  <TableHead className="min-w-44">Nama Siswa</TableHead>
                  <TableHead className="min-w-24">Kelas</TableHead>
                  <TableHead className="min-w-40">Keluhan</TableHead>
                  <TableHead className="min-w-48">Tindakan yang Diberikan</TableHead>
                  <TableHead className="min-w-40">Tindak Lanjut</TableHead>
                  {canEdit ? <TableHead className="w-20 text-right">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {!hasVisits ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 8 : 7} className="h-40">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <HeartPulse className="size-5" />
                        </span>
                        <p className="text-sm text-muted-foreground">
                          Belum ada kunjungan UKS yang tercatat.
                        </p>
                        {canEdit ? (
                          <Button size="sm" variant="outline" onClick={openCreate}>
                            <Plus className="size-4" />
                            Input Kunjungan
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  visits.map((visit, index) => (
                    <TableRow
                      key={visit.id}
                      // Edit affordance appears on hover/focus instead of a permanent column.
                      className={canEdit ? "group/row cursor-pointer" : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      role={canEdit ? "button" : undefined}
                      aria-label={canEdit ? `Edit kunjungan ${visit.studentName}` : undefined}
                      onClick={canEdit ? () => openEdit(visit) : undefined}
                      onKeyDown={
                        canEdit
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                openEdit(visit)
                              }
                            }
                          : undefined
                      }
                    >
                      <TableCell className="text-muted-foreground tabular-nums">
                        {tableRowNumber(index)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {visitDate(visit.occurredAt)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <span className="text-foreground">{visit.studentName}</span>
                          {canEdit ? (
                            <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100" />
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{visit.className}</TableCell>
                      <TableCell className="max-w-56">
                        <span className="line-clamp-2">{visit.complaint}</span>
                      </TableCell>
                      <TableCell className="max-w-64">
                        <span className="line-clamp-2">{visit.treatment}</span>
                      </TableCell>
                      <TableCell className="max-w-56">
                        {visit.followUp ? (
                          <span className="line-clamp-2">{visit.followUp}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {canEdit ? (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Hapus kunjungan ${visit.studentName}`}
                            disabled={deletingId === visit.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void remove(visit)
                            }}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {canEdit ? (
        <EuksVisitDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          draft={draft}
          students={students}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </section>
  )
}

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { HeartPulse, Pencil, Plus, Send, Trash2 } from "lucide-react"
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
import {
  notifyActionLabel,
  notifyStatusLabel,
  requiresResendConfirmation,
  resendConfirmationMessage,
} from "@/lib/euks-notification"

type Props = {
  visits: EuksVisitRow[]
  students: EuksStudentOption[]
  complaintOptions?: string[]
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  /** Hak mengirim notifikasi WhatsApp ke wali kelas (`euks.visits.notify`). */
  canNotify?: boolean
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

export function EuksVisitTable({
  visits,
  students,
  complaintOptions = [],
  canCreate,
  canUpdate,
  canDelete,
  canNotify = false,
}: Props) {
  const { today } = useSchoolTimeZone()
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<VisitDraft>(() => emptyVisitDraft(today()))
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [notifyingId, setNotifyingId] = useState<string | null>(null)

  const hasVisits = visits.length > 0

  function openCreate() {
    setDraft(emptyVisitDraft(today()))
    setFormOpen(true)
  }

  function openEdit(visit: EuksVisitRow) {
    if (!canUpdate) return
    setDraft(toDraft(visit))
    setFormOpen(true)
  }

  /**
   * Kirim atau kirim ulang notifikasi ke wali kelas.
   *
   * KONFIRMASI HANYA UNTUK KIRIM ULANG, dan aturannya tidak ditulis di sini:
   * `requiresResendConfirmation` adalah satu-satunya tempat keputusan itu
   * hidup, sehingga tombol dan konfirmasi tidak pernah berbeda pendapat.
   */
  async function notify(visit: EuksVisitRow) {
    if (!canNotify || notifyingId) return
    if (requiresResendConfirmation(visit.notifyStatus)) {
      const confirmed = window.confirm(
        resendConfirmationMessage({
          studentName: visit.studentName,
          recipientName: visit.notifyRecipientName,
        }),
      )
      if (!confirmed) return
    }

    setNotifyingId(visit.id)
    try {
      const response = await fetch(`/api/e-uks/visits/${visit.id}/notify`, { method: "POST" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Notifikasi gagal dikirim")
      if (data.status === "SENT") toast.success(data.message)
      else toast.error(data.message)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notifikasi gagal dikirim")
    } finally {
      setNotifyingId(null)
    }
  }

  async function remove(visit: EuksVisitRow) {
    if (!canDelete || deletingId) return
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
      {canCreate ? (
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
                  {canNotify ? (
                    <TableHead className="min-w-36">Notifikasi</TableHead>
                  ) : null}
                  {canNotify || canDelete ? (
                    <TableHead className="w-32 text-right">Aksi</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {!hasVisits ? (
                  <TableRow>
                    {/* Jumlah kolom dihitung dari kolom yang benar-benar
                        dirender; angka tetap akan meleset begitu satu kolom
                        bersyarat ditambahkan. */}
                    <TableCell
                      colSpan={7 + (canNotify ? 1 : 0) + (canNotify || canDelete ? 1 : 0)}
                      className="h-40"
                    >
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <HeartPulse className="size-5" />
                        </span>
                        <p className="text-sm text-muted-foreground">
                          Belum ada kunjungan UKS yang tercatat.
                        </p>
                        {canCreate ? (
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
                      className={canUpdate ? "group/row cursor-pointer" : undefined}
                      tabIndex={canUpdate ? 0 : undefined}
                      role={canUpdate ? "button" : undefined}
                      aria-label={canUpdate ? `Edit kunjungan ${visit.studentName}` : undefined}
                      onClick={canUpdate ? () => openEdit(visit) : undefined}
                      onKeyDown={
                        canUpdate
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
                          {canUpdate ? (
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
                      {canNotify ? (
                        <TableCell className="max-w-44">
                          <span className="flex flex-col gap-0.5">
                            <span
                              className={
                                visit.notifyStatus === "SENT"
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              }
                            >
                              {notifyStatusLabel(visit.notifyStatus)}
                            </span>
                            {/* Penerima dan alasan gagal ikut tampil: tanpa
                                keduanya petugas hanya tahu "gagal" dan tidak
                                tahu apa yang harus diperbaiki. */}
                            {visit.notifyStatus === "SENT" && visit.notifyRecipientName ? (
                              <span className="line-clamp-1 text-xs text-muted-foreground">
                                {visit.notifyRecipientName}
                              </span>
                            ) : null}
                            {visit.notifyStatus !== "SENT" && visit.notifyError ? (
                              <span className="line-clamp-2 text-xs text-muted-foreground">
                                {visit.notifyError}
                              </span>
                            ) : null}
                          </span>
                        </TableCell>
                      ) : null}
                      {canNotify || canDelete ? (
                        <TableCell className="text-right">
                          <span className="flex items-center justify-end gap-1">
                            {canNotify ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={notifyingId === visit.id}
                                aria-label={`${notifyActionLabel(visit.notifyStatus)} notifikasi kunjungan ${visit.studentName}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void notify(visit)
                                }}
                              >
                                <Send className="size-4" />
                                {notifyActionLabel(visit.notifyStatus)}
                              </Button>
                            ) : null}
                            {canDelete ? (
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
                            ) : null}
                          </span>
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

      {canCreate || canUpdate ? (
        <EuksVisitDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          draft={draft}
          students={students}
          complaintOptions={complaintOptions}
          canNotify={canNotify}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </section>
  )
}

"use client"

import { useState } from "react"
import { History, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Combobox } from "@/components/ui/combobox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ImportPanel } from "@/components/jadwal/import-panel"
import {
  ScheduleEntryDialog,
  draftFromEntry,
  emptyDraft,
  type EntryDraft,
} from "@/components/jadwal/schedule-entry-dialog"
import { scheduleFetch, useScheduleResource } from "@/components/jadwal/use-schedule-resource"
import {
  SCHEDULE_DAY_LABELS,
  formatTimeRange,
  scheduleDayLabel,
  type ScheduleDay,
} from "@/lib/schedule-constants"
import { lessonSlots, orderedDays, slotByPeriod, type ProfileDay, type TimeSlot } from "@/lib/schedule-time"
import type { ScheduleCapabilities } from "@/lib/schedule-authorization"
import type {
  ScheduleEntryView,
  ScheduleMasterData,
  ScheduleNowContext,
  ScheduleRevisionView,
} from "@/lib/server-schedule"

type ClassPayload = {
  schoolClass: { id: string; name: string }
  day: number
  slots: TimeSlot[]
  entries: ScheduleEntryView[]
  now: ScheduleNowContext
}

const REVISION_SOURCE_LABELS: Record<ScheduleRevisionView["source"], string> = {
  ASC_IMPORT: "Impor aSc",
  MANUAL: "Edit manual",
  ROLLBACK: "Rollback",
}

/**
 * Tab "Kelola Jadwal".
 *
 * Menyatukan dua alur yang memang berbeda sifatnya: perubahan BESAR lewat impor
 * aSc, dan perubahan KECIL lewat editor manual per slot. Keduanya menulis ke
 * revisi aktif yang sama, sehingga riwayat tetap satu garis waktu.
 */
export function ManageScheduleTab({
  capabilities,
  master,
  days,
  todayDay,
}: {
  capabilities: ScheduleCapabilities
  master: ScheduleMasterData
  days: readonly ProfileDay[]
  todayDay: ScheduleDay | null
}) {
  const configured = orderedDays([...days]).filter((item) => item.slots.length > 0)
  const initialDay =
    (todayDay !== null && configured.some((item) => item.day === todayDay)
      ? todayDay
      : configured[0]?.day) ?? 1
  const [day, setDay] = useState<ScheduleDay>(initialDay as ScheduleDay)
  const [classId, setClassId] = useState("")
  const [draft, setDraft] = useState<EntryDraft | null>(null)
  const [deleting, setDeleting] = useState<ScheduleEntryView | null>(null)
  const [busy, setBusy] = useState(false)

  const editor = useScheduleResource<ClassPayload>(
    classId ? `/api/jadwal/kelas?classId=${encodeURIComponent(classId)}&day=${day}` : null,
  )
  const revisions = useScheduleResource<{ revisions: ScheduleRevisionView[] }>(
    capabilities.revisionsRead ? "/api/jadwal/revisi" : null,
  )

  // Baris editor mengikuti struktur waktu HARI YANG SEDANG DIBUKA, yang ikut
  // dikirim balik oleh `/api/jadwal/kelas`. Memakai satu daftar slot generik
  // membuat setiap hari menampilkan jam milik hari pertama.
  const daySlots: readonly TimeSlot[] =
    editor.data?.slots ?? configured.find((item) => item.day === day)?.slots ?? []
  const lessons = lessonSlots([...daySlots])
  const byPeriod = slotByPeriod([...daySlots])

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await scheduleFetch("/api/jadwal/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleting.id }),
      })
      toast.success("Jadwal dihapus")
      setDeleting(null)
      editor.reload()
      revisions.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Jadwal gagal dihapus")
    } finally {
      setBusy(false)
    }
  }

  async function rollback(revision: ScheduleRevisionView) {
    setBusy(true)
    try {
      await scheduleFetch("/api/jadwal/revisi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: revision.id }),
      })
      toast.success(`Jadwal dikembalikan ke Versi ${revision.number}`)
      editor.reload()
      revisions.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rollback gagal")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {capabilities.import ? (
        <ImportPanel
          master={master}
          onApplied={() => {
            editor.reload()
            revisions.reload()
          }}
        />
      ) : null}

      {capabilities.manage ? (
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Editor Jadwal Manual</CardTitle>
            <CardDescription>
              Untuk perubahan kecil, misalnya mengganti pengajar pada satu jam. Bentrok kelas maupun guru
              ditolak server, tidak pernah ditimpa diam-diam.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="kelola-hari">Hari</Label>
                <Select
                  value={String(day)}
                  onValueChange={(value) => value && setDay(Number(value) as ScheduleDay)}
                >
                  <SelectTrigger id="kelola-hari" className="w-full">
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
              <div className="space-y-1.5">
                <Label htmlFor="kelola-kelas">Kelas</Label>
                <Combobox
                  id="kelola-kelas"
                  options={master.classes.map((item) => ({
                    value: item.id,
                    label: item.name,
                    description: `Tingkat ${item.grade}`,
                  }))}
                  value={classId ? classId : null}
                  placeholder="Cari kelas"
                  emptyMessage="Kelas tidak ditemukan"
                  onValueChange={(value) => setClassId(value ?? "")}
                />
              </div>
            </div>

            {!classId ? (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Pilih kelas untuk menyunting jadwalnya pada hari terpilih.
              </p>
            ) : editor.loading ? (
              <p className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Memuat jadwal…
              </p>
            ) : editor.error ? (
              <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                {editor.error}
              </p>
            ) : editor.data ? (
              <div className="overflow-x-auto rounded-xl border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">Jam</TableHead>
                      <TableHead>Mata Pelajaran</TableHead>
                      <TableHead>Guru</TableHead>
                      <TableHead className="w-28">Ruang</TableHead>
                      <TableHead className="w-40 text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lessons.map((slot) => {
                      const period = slot.ascPeriod as number
                      const entry = editor.data!.entries.find((item) => item.period === period) ?? null
                      return (
                        <TableRow key={slot.id}>
                          <TableCell className="font-medium">
                            <span className="block">{slot.name}</span>
                            <span className="block text-xs font-normal text-muted-foreground">
                              {formatTimeRange(slot.startMinute, slot.endMinute)}
                            </span>
                          </TableCell>
                          <TableCell>{entry?.subjectName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {entry ? (entry.teacherName ?? "Guru belum ditetapkan") : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{entry?.room ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {entry ? (
                                <>
                                  {capabilities.entries.update ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setDraft(draftFromEntry(entry))}
                                    >
                                      <Pencil className="size-4" />
                                      Ubah
                                    </Button>
                                  ) : null}
                                  {capabilities.entries.delete ? (
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label="Hapus jadwal"
                                      onClick={() => setDeleting(entry)}
                                    >
                                      <Trash2 className="size-4 text-destructive" />
                                    </Button>
                                  ) : null}
                                </>
                              ) : capabilities.entries.create ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setDraft({ ...emptyDraft(day, period), classId })
                                  }
                                >
                                  <Plus className="size-4" />
                                  Isi
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {capabilities.revisionsRead ? (
        <Card className="border-border/70">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <History className="size-5" />
              </span>
              <div>
                <CardTitle>Riwayat Versi Jadwal</CardTitle>
                <CardDescription>
                  Setiap impor, suntingan manual, dan rollback menghasilkan jejak. Rollback membuat versi
                  BARU dari isi versi lama; riwayat tidak pernah dihapus.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {revisions.loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Memuat riwayat…
              </p>
            ) : revisions.error ? (
              <p className="text-sm text-destructive">{revisions.error}</p>
            ) : revisions.data && revisions.data.revisions.length > 0 ? (
              <ul className="divide-y">
                {revisions.data.revisions.map((revision) => (
                  <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        Versi {revision.number}
                        {revision.active ? <Badge>Aktif</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {REVISION_SOURCE_LABELS[revision.source]} · {revision.entryCount} penempatan ·{" "}
                        {new Date(revision.createdAt).toLocaleString("id-ID")}
                        {revision.createdByName ? ` · ${revision.createdByName}` : ""}
                      </p>
                    </div>
                    {capabilities.rollback && !revision.active ? (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => rollback(revision)}>
                        <RotateCcw className="size-4" />
                        Kembalikan
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Belum ada versi jadwal yang tercatat.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {draft ? (
        <ScheduleEntryDialog
          key={`${draft.id ?? "new"}-${draft.day}-${draft.period}`}
          open
          onOpenChange={(value) => !value && setDraft(null)}
          draft={draft}
          days={configured}
          master={master}
          onSaved={() => {
            setDraft(null)
            editor.reload()
            revisions.reload()
          }}
        />
      ) : null}

      <Dialog open={deleting !== null} onOpenChange={(value) => !value && !busy && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus jadwal ini?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `${SCHEDULE_DAY_LABELS[deleting.day as ScheduleDay]} ${byPeriod.get(deleting.period)?.name ?? `jam ke-${deleting.period}`} · ${deleting.className} · ${deleting.subjectName}. Tindakan ini tercatat pada audit log.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

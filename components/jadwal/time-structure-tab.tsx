"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { scheduleFetch } from "@/components/jadwal/use-schedule-resource"
import {
  SCHEDULE_SLOT_KINDS,
  SCHEDULE_SLOT_KIND_LABELS,
  parseTimeOfDay,
  toTimeInputValue,
  type ScheduleSlotKind,
} from "@/lib/schedule-constants"
import { MAX_ASC_PERIOD, validateTimeStructure, type TimeSlot } from "@/lib/schedule-time"

type Draft = {
  key: string
  kind: ScheduleSlotKind
  name: string
  start: string
  end: string
  ascPeriod: string
}

let draftSeq = 0
function nextKey(): string {
  draftSeq += 1
  return `draft-${draftSeq}`
}

function toDraft(slot: TimeSlot): Draft {
  return {
    key: slot.id,
    kind: slot.kind,
    name: slot.name,
    start: toTimeInputValue(slot.startMinute),
    end: toTimeInputValue(slot.endMinute),
    ascPeriod: slot.ascPeriod === null ? "" : String(slot.ascPeriod),
  }
}

/**
 * Tab "Waktu & Kegiatan".
 *
 * Inilah sumber kebenaran jam mulai/selesai sekolah. `starttime`/`endtime` pada
 * berkas aSc tidak pernah menimpanya — XML hanya menyumbang NOMOR period, dan
 * nomor itulah yang dipetakan ke baris "Jam ke-n" di sini.
 *
 * Penyimpanan mengganti seluruh struktur satu profil dalam satu transaksi,
 * bukan menambal baris satu per satu: reorder dan penghapusan menjadi satu
 * keputusan utuh yang tidak bisa setengah jadi.
 */
export function TimeStructureTab({
  profile,
  onSaved,
}: {
  profile: { id: string; name: string; slots: readonly TimeSlot[] }
  onSaved?: () => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => profile.slots.map(toDraft))
  const [saving, setSaving] = useState(false)

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function move(index: number, direction: -1 | 1) {
    setDrafts((rows) => {
      const target = index + direction
      if (target < 0 || target >= rows.length) return rows
      const next = [...rows]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  function addRow() {
    setDrafts((rows) => [
      ...rows,
      { key: nextKey(), kind: "PELAJARAN", name: "", start: "", end: "", ascPeriod: "" },
    ])
  }

  function toPayload() {
    return drafts.map((row, index) => ({
      position: index + 1,
      kind: row.kind,
      name: row.name.trim(),
      startMinute: parseTimeOfDay(row.start) ?? -1,
      endMinute: parseTimeOfDay(row.end) ?? -1,
      ascPeriod: row.kind === "PELAJARAN" && row.ascPeriod.trim() ? Number(row.ascPeriod) : null,
    }))
  }

  async function save() {
    const slots = toPayload()
    // Divalidasi dengan modul yang sama yang dipakai server, sehingga pesan
    // yang dilihat admin persis sama dengan alasan penolakan sebenarnya.
    const problems = validateTimeStructure(slots)
    if (problems.length > 0) {
      toast.error(problems[0], { description: problems.length > 1 ? `dan ${problems.length - 1} masalah lain` : undefined })
      return
    }

    setSaving(true)
    try {
      await scheduleFetch("/api/jadwal/waktu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, slots }),
      })
      toast.success("Struktur waktu disimpan")
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Struktur waktu gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Profil waktu: {profile.name}</p>
          <p className="text-sm text-muted-foreground">
            Jam pelajaran, istirahat, dan kegiatan sekolah. Nomor jam menghubungkan baris PELAJARAN
            dengan <span className="font-medium">period</span> pada berkas aSc.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={addRow} disabled={saving}>
            <Plus className="size-4" />
            Tambah Baris
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Simpan
          </Button>
        </div>
      </div>

      {drafts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Belum ada baris. Tambahkan minimal satu jam pelajaran.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Urutan</TableHead>
                <TableHead className="w-40">Jenis</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead className="w-32">Mulai</TableHead>
                <TableHead className="w-32">Selesai</TableHead>
                <TableHead className="w-28">Jam ke-</TableHead>
                <TableHead className="w-32 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((row, index) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{index + 1}</TableCell>
                  <TableCell>
                    <Select
                      value={row.kind}
                      onValueChange={(value) =>
                        value &&
                        update(row.key, {
                          kind: value as ScheduleSlotKind,
                          ascPeriod: value === "PELAJARAN" ? row.ascPeriod : "",
                        })
                      }
                    >
                      <SelectTrigger className="w-full" aria-label="Jenis slot">
                        <SelectValue>
                          {(value: string) => SCHEDULE_SLOT_KIND_LABELS[value as ScheduleSlotKind] ?? value}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SCHEDULE_SLOT_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {SCHEDULE_SLOT_KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Label className="sr-only" htmlFor={`slot-name-${row.key}`}>
                      Nama slot
                    </Label>
                    <Input
                      id={`slot-name-${row.key}`}
                      value={row.name}
                      onChange={(event) => update(row.key, { name: event.target.value })}
                      placeholder="Jam ke-1 / Istirahat 1 / Upacara"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      aria-label="Jam mulai"
                      value={row.start}
                      onChange={(event) => update(row.key, { start: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      aria-label="Jam selesai"
                      value={row.end}
                      onChange={(event) => update(row.key, { end: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      max={MAX_ASC_PERIOD}
                      aria-label="Nomor jam pelajaran"
                      disabled={row.kind !== "PELAJARAN"}
                      value={row.ascPeriod}
                      onChange={(event) => update(row.key, { ascPeriod: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Naikkan urutan"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Turunkan urutan"
                        disabled={index === drafts.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Hapus baris"
                        onClick={() => setDrafts((rows) => rows.filter((item) => item.key !== row.key))}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

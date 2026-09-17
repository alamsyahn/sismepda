"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Copy, FileText, Loader2, Plus, Save, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { scheduleFetch } from "@/components/jadwal/use-schedule-resource"
import {
  ALL_WEEKDAYS,
  SCHEDULE_DAY_LABELS,
  SCHEDULE_SLOT_KINDS,
  SCHEDULE_SLOT_KIND_LABELS,
  formatTimeRange,
  parseTimeOfDay,
  scheduleDayLabel,
  toTimeInputValue,
  type ScheduleSlotKind,
  type Weekday,
} from "@/lib/schedule-constants"
import { MAX_ASC_PERIOD, validateTimeStructure, type TimeSlot } from "@/lib/schedule-time"
import type { ScheduleProfileDayView, ScheduleTimeTemplateView } from "@/lib/server-schedule"

type Draft = {
  key: string
  kind: ScheduleSlotKind
  name: string
  start: string
  end: string
  ascPeriod: string
}

type ProfileShape = {
  id: string
  name: string
  days: readonly ScheduleProfileDayView[]
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

function toPayload(drafts: readonly Draft[]) {
  return drafts.map((row, index) => ({
    position: index + 1,
    kind: row.kind,
    name: row.name.trim(),
    startMinute: parseTimeOfDay(row.start) ?? -1,
    endMinute: parseTimeOfDay(row.end) ?? -1,
    ascPeriod: row.kind === "PELAJARAN" && row.ascPeriod.trim() ? Number(row.ascPeriod) : null,
  }))
}

/** Rentang jam sebuah struktur, untuk ringkasan sekilas. */
function summarize(slots: readonly TimeSlot[]): string {
  if (slots.length === 0) return "kosong"
  const start = Math.min(...slots.map((slot) => slot.startMinute))
  const end = Math.max(...slots.map((slot) => slot.endMinute))
  return formatTimeRange(start, end)
}

/**
 * Tab "Waktu & Kegiatan".
 *
 * Inilah sumber kebenaran jam mulai/selesai sekolah. `starttime`/`endtime` pada
 * berkas aSc tidak pernah menimpanya — XML hanya menyumbang NOMOR period, dan
 * nomor itulah yang dipetakan ke baris "Jam ke-n" di sini.
 *
 * Struktur disimpan PER HARI: nomor jam yang sama boleh berjam berbeda pada
 * Senin dan Jumat. Karena itu tabel di bawah selalu milik satu hari terpilih,
 * dan penyimpanan mengganti seluruh struktur hari itu dalam satu transaksi —
 * bukan menambal baris satu per satu, supaya reorder dan penghapusan menjadi
 * satu keputusan utuh yang tidak bisa setengah jadi.
 *
 * Template adalah SALINAN, bukan referensi hidup: menerapkan template menyalin
 * isinya ke hari, lalu hari itu berdiri sendiri selamanya.
 */
export function TimeStructureTab({
  profile,
  templates,
  canManage,
  onSaved,
}: {
  profile: ProfileShape
  templates: readonly ScheduleTimeTemplateView[]
  canManage: boolean
  onSaved?: () => void
}) {
  const days = profile.days
  const [activeDay, setActiveDay] = useState<number>(() => days[0]?.day ?? 1)
  const current = days.find((item) => item.day === activeDay) ?? days[0] ?? null

  const [drafts, setDrafts] = useState<Draft[]>(() => (current ? current.slots.map(toDraft) : []))
  const [busy, setBusy] = useState(false)
  const [copySource, setCopySource] = useState<number | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<ScheduleTimeTemplateView | null>(null)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [manageOpen, setManageOpen] = useState(false)

  // Berpindah hari memuat ulang draft dari data hari itu. Draft yang belum
  // disimpan sengaja tidak dibawa pindah: membawanya akan membuat admin
  // menyimpan struktur Senin ke atas Jumat tanpa sadar.
  // Kunci ikut memuat ISI baris, bukan hanya jumlahnya. Mengubah jam 07:00
  // menjadi 07:15 tidak mengubah panjang daftar, sehingga kunci berbasis
  // panjang membuat draft lama bertahan dan layar tampak belum tersimpan
  // meski server sudah menyimpannya.
  const currentKey = current
    ? `${current.id}:${current.slots
        .map((slot) => `${slot.position}|${slot.kind}|${slot.name}|${slot.startMinute}|${slot.endMinute}|${slot.ascPeriod ?? ""}`)
        .join(";")}`
    : "none"
  useEffect(() => {
    setDrafts(current ? current.slots.map(toDraft) : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey])

  const otherDays = useMemo(
    () => days.filter((item) => item.day !== activeDay && item.slots.length > 0),
    [days, activeDay],
  )

  const availableDays = useMemo(
    () => ALL_WEEKDAYS.filter((day) => !days.some((item) => item.day === day)),
    [days],
  )

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

  /** Satu pintu untuk semua mutasi: mencegah kiriman ganda dan menelan error. */
  async function run(label: string, action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      toast.success(label)
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operasi gagal")
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!current) return
    const slots = toPayload(drafts)
    // Divalidasi dengan modul yang sama yang dipakai server, sehingga pesan
    // yang dilihat admin persis sama dengan alasan penolakan sebenarnya.
    const problems = validateTimeStructure(slots)
    if (problems.length > 0) {
      toast.error(problems[0], {
        description: problems.length > 1 ? `dan ${problems.length - 1} masalah lain` : undefined,
      })
      return
    }

    await run(`Struktur waktu ${scheduleDayLabel(current.day)} disimpan`, () =>
      scheduleFetch("/api/jadwal/waktu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, day: current.day, slots }),
      }),
    )
  }

  function post(body: Record<string, unknown>) {
    return scheduleFetch("/api/jadwal/waktu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  if (!current) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Profil waktu ini belum memiliki hari. Tambahkan minimal satu hari.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium">Profil waktu: {profile.name}</p>
          <p className="text-sm text-muted-foreground">
            Struktur waktu disimpan per hari. Nomor jam menghubungkan baris PELAJARAN dengan{" "}
            <span className="font-medium">period</span> pada berkas aSc; jam yang sama boleh berbeda
            waktunya antarhari.
          </p>
        </div>
      </div>

      {/* Pemilih hari. Hari kosong ditandai supaya admin tahu mana yang belum disiapkan. */}
      <div className="flex flex-wrap items-center gap-2">
        {days.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={item.day === activeDay ? "default" : "outline"}
            onClick={() => setActiveDay(item.day)}
            disabled={busy}
          >
            {scheduleDayLabel(item.day)}
            <Badge variant={item.slots.length > 0 ? "secondary" : "outline"} className="ml-1">
              {item.slots.length > 0 ? item.slots.length : "kosong"}
            </Badge>
          </Button>
        ))}

        {canManage && availableDays.length > 0 ? (
          <Menu>
            <MenuTrigger
              render={<Button size="sm" variant="ghost" aria-label="Tambah hari" disabled={busy} />}
            >
              <Plus className="size-4" />
            </MenuTrigger>
            <MenuContent>
              {availableDays.map((day) => (
                <MenuItem
                  key={day}
                  onClick={() =>
                    run(`Hari ${scheduleDayLabel(day)} ditambahkan`, async () => {
                      await post({ action: "addDay", profileId: profile.id, day })
                      setActiveDay(day)
                    })
                  }
                >
                  {SCHEDULE_DAY_LABELS[day as Weekday]}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Menu>
            <MenuTrigger render={<Button variant="outline" size="sm" disabled={busy || otherDays.length === 0} />}>
              <Copy className="size-4" />
              Salin dari Hari
            </MenuTrigger>
            <MenuContent>
              {otherDays.map((item) => (
                <MenuItem key={item.id} onClick={() => setCopySource(item.day)}>
                  {scheduleDayLabel(item.day)} · {summarize(item.slots)}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>

          <Menu>
            <MenuTrigger render={<Button variant="outline" size="sm" disabled={busy} />}>
              <FileText className="size-4" />
              Terapkan Template
            </MenuTrigger>
            <MenuContent>
              {templates.length === 0 ? (
                <MenuItem disabled>Belum ada template</MenuItem>
              ) : (
                templates.map((template) => (
                  <MenuItem key={template.id} onClick={() => setPendingTemplate(template)}>
                    {template.name} · {template.slots.length} baris
                  </MenuItem>
                ))
              )}
              <MenuSeparator />
              <MenuItem onClick={() => setManageOpen(true)}>Kelola Template</MenuItem>
            </MenuContent>
          </Menu>

          <Button
            variant="outline"
            size="sm"
            disabled={busy || current.slots.length === 0}
            onClick={() => {
              setTemplateName(`${profile.name} ${scheduleDayLabel(current.day)}`)
              setSaveTemplateOpen(true)
            }}
          >
            Simpan sebagai Template
          </Button>

          <Button variant="outline" size="sm" onClick={addRow} disabled={busy}>
            <Plus className="size-4" />
            Tambah Baris
          </Button>

          {days.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(`Hari ${scheduleDayLabel(current.day)} dihapus`, async () => {
                  await post({ action: "removeDay", profileId: profile.id, day: current.day })
                  setActiveDay(days.find((item) => item.day !== current.day)?.day ?? 1)
                })
              }
            >
              <X className="size-4" />
              Hapus Hari
            </Button>
          ) : null}

          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Simpan {scheduleDayLabel(current.day)}
          </Button>
        </div>
      ) : null}

      {drafts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {scheduleDayLabel(current.day)} belum memiliki struktur waktu. Tambahkan baris, salin dari
          hari lain, atau terapkan template.
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
                      <SelectTrigger className="w-full" aria-label="Jenis slot" disabled={!canManage}>
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
                      disabled={!canManage}
                      onChange={(event) => update(row.key, { name: event.target.value })}
                      placeholder="Jam ke-1 / Istirahat 1 / Upacara"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      aria-label="Jam mulai"
                      value={row.start}
                      disabled={!canManage}
                      onChange={(event) => update(row.key, { start: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      aria-label="Jam selesai"
                      value={row.end}
                      disabled={!canManage}
                      onChange={(event) => update(row.key, { end: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      max={MAX_ASC_PERIOD}
                      aria-label="Nomor jam pelajaran"
                      disabled={!canManage || row.kind !== "PELAJARAN"}
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
                        disabled={!canManage || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Turunkan urutan"
                        disabled={!canManage || index === drafts.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Hapus baris"
                        disabled={!canManage}
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

      {/* Menimpa struktur yang sudah ada selalu dikonfirmasi lebih dulu. */}
      <Dialog open={copySource !== null} onOpenChange={(value) => !value && !busy && setCopySource(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Salin {copySource === null ? "" : scheduleDayLabel(copySource)} ke{" "}
              {scheduleDayLabel(current.day)}?
            </DialogTitle>
            <DialogDescription>
              Struktur waktu {scheduleDayLabel(current.day)} saat ini akan diganti dengan salinan.
              Hari sumber tidak berubah, dan perubahannya nanti tidak ikut mengubah hari ini.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy}
              onClick={() => {
                const from = copySource
                if (from === null) return
                void run(
                  `Konfigurasi ${scheduleDayLabel(from)} berhasil disalin ke ${scheduleDayLabel(current.day)}.`,
                  async () => {
                    await post({
                      action: "copyDay",
                      profileId: profile.id,
                      fromDay: from,
                      toDay: current.day,
                    })
                    setCopySource(null)
                  },
                )
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
              Salin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingTemplate !== null}
        onOpenChange={(value) => !value && !busy && setPendingTemplate(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Terapkan template &ldquo;{pendingTemplate?.name}&rdquo; ke {scheduleDayLabel(current.day)}?
            </DialogTitle>
            <DialogDescription>
              Struktur waktu {scheduleDayLabel(current.day)} saat ini akan diganti dengan salinan
              template. Template dan hari lain tidak akan berubah.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy}
              onClick={() => {
                const template = pendingTemplate
                if (!template) return
                void run(`Template berhasil diterapkan ke ${scheduleDayLabel(current.day)}.`, async () => {
                  await post({
                    action: "applyTemplate",
                    profileId: profile.id,
                    day: current.day,
                    templateId: template.id,
                  })
                  setPendingTemplate(null)
                })
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              Terapkan Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveTemplateOpen} onOpenChange={(value) => !value && !busy && setSaveTemplateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Simpan sebagai template</DialogTitle>
            <DialogDescription>
              Template menyimpan SALINAN struktur {scheduleDayLabel(current.day)} saat ini. Mengubah
              hari ini setelahnya tidak mengubah template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="template-name">Nama template</Label>
            <Input
              id="template-name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Reguler Senin–Kamis"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy || templateName.trim().length === 0}
              onClick={() =>
                void run("Template berhasil disimpan.", async () => {
                  await scheduleFetch("/api/jadwal/waktu/template", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      source: "day",
                      name: templateName,
                      profileId: profile.id,
                      day: current.day,
                    }),
                  })
                  setSaveTemplateOpen(false)
                })
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplateManagerDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        templates={templates}
        busy={busy}
        onMutate={run}
      />
    </div>
  )
}

/**
 * Daftar template beserta aksinya.
 *
 * Menghapus template TIDAK menyentuh hari mana pun: tidak ada kolom yang
 * menautkan hari ke template asalnya, dan itulah yang membuat penghapusan aman.
 */
function TemplateManagerDialog({
  open,
  onOpenChange,
  templates,
  busy,
  onMutate,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  templates: readonly ScheduleTimeTemplateView[]
  busy: boolean
  onMutate: (label: string, action: () => Promise<unknown>) => Promise<void>
}) {
  const [deleting, setDeleting] = useState<ScheduleTimeTemplateView | null>(null)
  const [renaming, setRenaming] = useState<ScheduleTimeTemplateView | null>(null)
  const [name, setName] = useState("")

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Kelola template waktu</DialogTitle>
            <DialogDescription>
              Template hanya dipakai sebagai sumber salinan. Mengedit atau menghapusnya tidak pernah
              mengubah hari yang sudah dibuat dari template ini.
            </DialogDescription>
          </DialogHeader>

          {templates.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Belum ada template. Simpan struktur sebuah hari sebagai template untuk memakainya ulang.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead className="w-24">Baris</TableHead>
                    <TableHead className="w-36">Rentang</TableHead>
                    <TableHead className="w-40">Diperbarui</TableHead>
                    <TableHead className="w-44 text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell className="font-medium">{template.name}</TableCell>
                      <TableCell>{template.slots.length}</TableCell>
                      <TableCell>{summarize(template.slots)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(template.updatedAt).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setName(template.name)
                              setRenaming(template)
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void onMutate("Template berhasil diduplikasi.", () =>
                                scheduleFetch("/api/jadwal/waktu/template", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ source: "duplicate", templateId: template.id }),
                                }),
                              )
                            }
                          >
                            Duplikat
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setDeleting(template)}
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
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(value) => !value && !busy && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
            <DialogDescription>
              Perubahan hanya berlaku pada template. Hari yang pernah memakainya tidak ikut berubah.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="template-rename">Nama template</Label>
            <Input
              id="template-rename"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              disabled={busy || name.trim().length === 0}
              onClick={() => {
                const template = renaming
                if (!template) return
                void onMutate("Template berhasil diperbarui.", async () => {
                  await scheduleFetch("/api/jadwal/waktu/template", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      templateId: template.id,
                      name,
                      slots: template.slots.map((slot, index) => ({
                        position: index + 1,
                        kind: slot.kind,
                        name: slot.name,
                        startMinute: slot.startMinute,
                        endMinute: slot.endMinute,
                        ascPeriod: slot.ascPeriod,
                      })),
                    }),
                  })
                  setRenaming(null)
                })
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(value) => !value && !busy && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus template &ldquo;{deleting?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              Template akan dihapus dari daftar. Konfigurasi hari yang sebelumnya dibuat dari
              template ini tidak akan berubah.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Batal</DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const template = deleting
                if (!template) return
                void onMutate("Template berhasil dihapus.", async () => {
                  await scheduleFetch(
                    `/api/jadwal/waktu/template?templateId=${encodeURIComponent(template.id)}`,
                    { method: "DELETE" },
                  )
                  setDeleting(null)
                })
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

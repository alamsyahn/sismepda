"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarCheck, CalendarOff, CalendarSync, Check, Loader2, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { ExportButton } from "@/components/export/export-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatSchoolDate, requireSchoolDate } from "@/lib/school-date"
import { HOLIDAY_KIND_LABELS, WEEKDAY_NAMES, type HolidayKind } from "@/lib/holiday-rules"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"

type Holiday = {
  id: string
  kind: HolidayKind
  name: string
  date: string | null
  weekday: number | null
  startDate: string | null
  endDate: string | null
}

const KIND_HINTS: Record<HolidayKind, string> = {
  SINGLE: "Tanggal tertentu yang diliburkan, misalnya libur nasional.",
  RECURRING:
    "Hari yang berulang setiap pekan, misalnya hari Minggu. Kosongkan batas akhir bila berlaku selamanya.",
  SCHOOL_DAY:
    "Membatalkan libur pada satu tanggal sehingga tetap menjadi hari masuk.",
}

const KIND_ICONS: Record<HolidayKind, typeof CalendarOff> = {
  SINGLE: CalendarOff,
  RECURRING: CalendarSync,
  SCHOOL_DAY: CalendarCheck,
}

const formatDate = (value: string) => formatSchoolDate(requireSchoolDate(value))

export function HolidayManager() {
  const { today } = useSchoolTimeZone()
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [kind, setKind] = useState<HolidayKind>("SINGLE")
  const [date, setDate] = useState<string>(() => today())
  const [name, setName] = useState("")
  const [weekday, setWeekday] = useState("0")
  const [startDate, setStartDate] = useState<string>(() => today())
  const [endDate, setEndDate] = useState("")
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editEnd, setEditEnd] = useState("")

  useEffect(() => {
    fetch("/api/admin/holidays")
      .then((response) => response.json())
      .then(setHolidays)
      .catch(() => toast.error("Kalender libur gagal dimuat"))
  }, [])

  const grouped = useMemo(
    () => ({
      SINGLE: holidays.filter((item) => item.kind === "SINGLE"),
      RECURRING: holidays.filter((item) => item.kind === "RECURRING"),
      SCHOOL_DAY: holidays.filter((item) => item.kind === "SCHOOL_DAY"),
    }),
    [holidays],
  )

  const sortHolidays = (list: Holiday[]) =>
    [...list].sort((a, b) => (a.date ?? a.startDate ?? "").localeCompare(b.date ?? b.startDate ?? ""))

  async function addHoliday() {
    if (!name.trim()) {
      toast.error("Keterangan wajib diisi")
      return
    }
    const body =
      kind === "RECURRING"
        ? { kind, name, weekday: Number(weekday), startDate, endDate: endDate || null }
        : { kind, name, date }
    if (kind === "RECURRING" && !startDate) {
      toast.error("Batas awal wajib diisi")
      return
    }
    if (kind !== "RECURRING" && !date) {
      toast.error("Tanggal wajib diisi")
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/admin/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const saved = await response.json()
      if (!response.ok) {
        toast.error(saved.error ?? "Hari libur gagal disimpan")
        return
      }
      setHolidays((current) =>
        sortHolidays([...current.filter((item) => item.id !== saved.id), saved]),
      )
      setName("")
      setEndDate("")
      toast.success(`${HOLIDAY_KIND_LABELS[kind]} disimpan`)
    } catch {
      toast.error("Hari libur gagal disimpan")
    } finally {
      setSaving(false)
    }
  }

  async function saveEnd(holiday: Holiday) {
    setSaving(true)
    try {
      const response = await fetch("/api/admin/holidays", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: holiday.id, endDate: editEnd || null }),
      })
      const saved = await response.json()
      if (!response.ok) {
        toast.error(saved.error ?? "Masa berlaku gagal diperbarui")
        return
      }
      setHolidays((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      setEditing(null)
      toast.success("Masa berlaku diperbarui")
    } catch {
      toast.error("Masa berlaku gagal diperbarui")
    } finally {
      setSaving(false)
    }
  }

  async function removeHoliday(id: string) {
    const response = await fetch("/api/admin/holidays", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (response.ok) {
      setHolidays((current) => current.filter((item) => item.id !== id))
      toast.success("Entri dihapus")
    } else toast.error("Entri gagal dihapus")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarOff className="text-primary size-5" />
          Kalender Hari Libur
        </CardTitle>
        <CardDescription>
          Tanggal libur tidak dihitung sebagai kelas yang belum menginput absensi. Hari masuk
          khusus membatalkan libur pada tanggal tersebut.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex justify-end">
          <ExportButton type="holidays" label="Export Hari Libur" />
        </div>

        <div className="space-y-4 rounded-lg border border-border/70 p-4">
          <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="holiday-kind">Tipe</Label>
              <Select value={kind} onValueChange={(value) => value && setKind(value as HolidayKind)}>
                <SelectTrigger id="holiday-kind">
                  <SelectValue>{(value) => HOLIDAY_KIND_LABELS[value as HolidayKind]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(HOLIDAY_KIND_LABELS) as HolidayKind[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {HOLIDAY_KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground self-end text-sm">{KIND_HINTS[kind]}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
            {kind === "RECURRING" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="holiday-weekday">Hari</Label>
                  <Select value={weekday} onValueChange={(value) => value && setWeekday(value)}>
                    <SelectTrigger id="holiday-weekday">
                      <SelectValue>{(value) => WEEKDAY_NAMES[Number(value)]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_NAMES.map((label, index) => (
                        <SelectItem key={label} value={String(index)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holiday-start">Berlaku mulai</Label>
                  <Input
                    id="holiday-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holiday-end">Sampai</Label>
                  <Input
                    id="holiday-end"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">Kosongkan untuk selamanya.</p>
                </div>
              </>
            ) : (
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="holiday-date">Tanggal</Label>
                <Input
                  id="holiday-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            )}
            <div className="flex items-end">
              <Button onClick={addHoliday} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Tambahkan
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="holiday-name">Keterangan</Label>
            <Input
              id="holiday-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === "RECURRING" ? "Contoh: Hari Minggu" : "Contoh: Libur nasional"}
            />
          </div>
        </div>

        <Tabs defaultValue="SINGLE">
          <TabsList>
            {(Object.keys(HOLIDAY_KIND_LABELS) as HolidayKind[]).map((value) => (
              <TabsTrigger key={value} value={value}>
                {HOLIDAY_KIND_LABELS[value]} ({grouped[value].length})
              </TabsTrigger>
            ))}
          </TabsList>

          {(Object.keys(HOLIDAY_KIND_LABELS) as HolidayKind[]).map((value) => {
            const Icon = KIND_ICONS[value]
            return (
              <TabsContent key={value} value={value} className="space-y-2 pt-4">
                {grouped[value].length === 0 ? (
                  <p className="bg-muted/50 text-muted-foreground rounded-lg px-4 py-6 text-center text-sm">
                    Belum ada {HOLIDAY_KIND_LABELS[value].toLowerCase()}.
                  </p>
                ) : (
                  sortHolidays(grouped[value]).map((holiday) => (
                    <div
                      key={holiday.id}
                      className="border-border/70 flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="text-muted-foreground size-4 shrink-0" />
                        <div>
                          <p className="font-medium">{holiday.name}</p>
                          <p className="text-muted-foreground text-sm">
                            {holiday.kind === "RECURRING" ? (
                              editing === holiday.id ? (
                                <span className="flex items-center gap-2">
                                  Setiap {WEEKDAY_NAMES[holiday.weekday ?? 0]} sampai
                                  <Input
                                    type="date"
                                    className="h-8 w-40"
                                    value={editEnd}
                                    aria-label={`Batas akhir ${holiday.name}`}
                                    onChange={(event) => setEditEnd(event.target.value)}
                                  />
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label="Simpan batas akhir"
                                    disabled={saving}
                                    onClick={() => saveEnd(holiday)}
                                  >
                                    <Check className="size-4" />
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label="Batal"
                                    onClick={() => setEditing(null)}
                                  >
                                    <X className="size-4" />
                                  </Button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="hover:text-foreground underline-offset-4 hover:underline"
                                  onClick={() => {
                                    setEditing(holiday.id)
                                    setEditEnd(holiday.endDate ?? "")
                                  }}
                                >
                                  Setiap {WEEKDAY_NAMES[holiday.weekday ?? 0]}
                                  {holiday.startDate ? `, mulai ${formatDate(holiday.startDate)}` : ""}
                                  {holiday.endDate ? ` sampai ${formatDate(holiday.endDate)}` : " sampai selamanya"}
                                </button>
                              )
                            ) : holiday.date ? (
                              formatDate(holiday.date)
                            ) : (
                              "-"
                            )}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeHoliday(holiday.id)}
                        aria-label={`Hapus ${holiday.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      </CardContent>
    </Card>
  )
}

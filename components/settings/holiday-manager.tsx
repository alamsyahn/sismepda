"use client"

import { useEffect, useState } from "react"
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ExportButton } from "@/components/export/export-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatLongDate, localDateValue } from "@/lib/date"

type Holiday = { id: string; date: string; name: string }

export function HolidayManager() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [date, setDate] = useState(localDateValue())
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/admin/holidays").then((response) => response.json()).then(setHolidays).catch(() => toast.error("Kalender libur gagal dimuat"))
  }, [])

  async function addHoliday() {
    if (!date || !name.trim()) { toast.error("Tanggal dan keterangan wajib diisi"); return }
    setSaving(true)
    try {
      const response = await fetch("/api/admin/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, name }) })
      if (!response.ok) throw new Error()
      const saved = await response.json()
      setHolidays((current) => [...current.filter((item) => item.id !== saved.id && item.date.slice(0, 10) !== saved.date.slice(0, 10)), saved].sort((a, b) => a.date.localeCompare(b.date)))
      setName("")
      toast.success("Hari libur disimpan")
    } catch { toast.error("Hari libur gagal disimpan") }
    finally { setSaving(false) }
  }

  async function removeHoliday(id: string) {
    const response = await fetch("/api/admin/holidays", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
    if (response.ok) { setHolidays((current) => current.filter((item) => item.id !== id)); toast.success("Hari libur dihapus") }
    else toast.error("Hari libur gagal dihapus")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarOff className="size-5 text-primary" />Kalender Hari Libur</CardTitle>
        <CardDescription>Tanggal libur tidak akan dihitung sebagai kelas yang belum menginput absensi.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex justify-end"><ExportButton type="holidays" label="Export Hari Libur" /></div>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr_auto]">
          <div className="space-y-2"><Label htmlFor="holiday-date">Tanggal</Label><Input id="holiday-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="holiday-name">Keterangan</Label><Input id="holiday-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Libur nasional" /></div>
          <div className="flex items-end"><Button onClick={addHoliday} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Tambahkan</Button></div>
        </div>
        <div className="space-y-2">
          {holidays.length === 0 ? (
            <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">Belum ada hari libur yang ditandai.</p>
          ) : holidays.map((holiday) => (
            <div key={holiday.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-4 py-3">
              <div><p className="font-medium">{holiday.name}</p><p className="text-sm text-muted-foreground">{formatLongDate(holiday.date.slice(0, 10))}</p></div>
              <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => removeHoliday(holiday.id)} aria-label={`Hapus ${holiday.name}`}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

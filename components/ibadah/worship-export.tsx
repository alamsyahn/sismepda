"use client"

import { useState, type FormEvent } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WORSHIP_EXPORT_MAX_DAYS } from "@/lib/worship-attendance"

export function WorshipExport({ classes, classId, date, today, semesterStart }: {
  classes: { id: string; name: string }[]
  classId?: string
  date: string
  today: string
  semesterStart: string | null
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  const selected = classes.find((schoolClass) => schoolClass.id === classId) ?? classes[0]

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const values = new FormData(event.currentTarget)
    const params = new URLSearchParams({ classId: String(values.get("classId")), from, to })
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/rekap-ibadah/export?${params}`)
      const disposition = response.headers.get("Content-Disposition")
      if (!response.ok || !disposition) {
        const result = await response.json().catch(() => null)
        throw new Error(result?.error ?? "File Excel gagal diunduh. Periksa akses Anda atau masuk kembali.")
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `rekap-ibadah-${from}-${to}.xlsx`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setOpen(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "File Excel gagal diunduh")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (busy) return
      setError("")
      setOpen(next)
    }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Download /> Ekspor Excel
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ekspor Rekap Ibadah</DialogTitle>
          <DialogDescription>Pilih kelas dan rentang hingga {WORSHIP_EXPORT_MAX_DAYS} hari.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={download}>
          <div className="grid gap-2">
            <Label htmlFor="ibadah-export-class">Kelas</Label>
            <select id="ibadah-export-class" name="classId" defaultValue={selected?.id}
              className="h-9 rounded-md border bg-background px-3 text-sm" disabled={busy}>
              {classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ibadah-export-from">Tanggal awal</Label>
              <Input id="ibadah-export-from" type="date" value={from} max={today}
                onChange={(event) => setFrom(event.target.value)} disabled={busy} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ibadah-export-to">Tanggal akhir</Label>
              <Input id="ibadah-export-to" type="date" value={to} min={from} max={today}
                onChange={(event) => setTo(event.target.value)} disabled={busy} required />
            </div>
          </div>
          {semesterStart && (
            <Button type="button" variant="outline" className="justify-self-start" disabled={busy} onClick={() => {
              setFrom(semesterStart)
              setTo(today)
              setError("")
            }}>Semester berjalan</Button>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyiapkan Excel…" : "Unduh .xlsx"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

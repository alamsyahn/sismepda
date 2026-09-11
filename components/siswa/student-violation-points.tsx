"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2, Plus, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import type { PointLevel } from "@/lib/student-violation-points"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProfileNameLink } from "@/components/profile/profile-name-link"

const categories = [
  ["Terlambat", 5], ["Tidak memakai atribut lengkap", 5], ["Tidak mengerjakan tugas", 10],
  ["Meninggalkan kelas tanpa izin", 15], ["Merokok", 25], ["Perkelahian", 30], ["Pelanggaran lainnya", 10],
] as const

type PointRecord = { id: string; category: string; points: number; note: string | null; occurredAt: Date; recordedBy: { id: string; name: string } }

export function StudentViolationPoints({ studentId, summary, records }: { studentId: string; summary: { totalPoints: number; currentMonthPoints: number; recordCount: number; progress: number; level: PointLevel }; records: PointRecord[] }) {
  const { today } = useSchoolTimeZone()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState(categories[0][0])
  const [points, setPoints] = useState(String(categories[0][1]))
  const [occurredAt, setOccurredAt] = useState<string>(() => today())
  const [note, setNote] = useState("")
  const circumference = 2 * Math.PI * 50
  const dashOffset = circumference * (1 - summary.progress / 100)

  async function save() {
    setSaving(true)
    try {
      const response = await fetch(`/api/students/${studentId}/violation-points`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, points: Number(points), occurredAt, note }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Poin gagal disimpan")
      toast.success("Poin pelanggaran berhasil ditambahkan")
      setOpen(false); setNote(""); router.refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Poin gagal disimpan") }
    finally { setSaving(false) }
  }

  return <Card className="border-border/70"><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className={`flex size-10 items-center justify-center rounded-xl ${summary.level.softColor}`}><ShieldAlert className="size-5" /></span><div><CardTitle>Poin Pelanggaran</CardTitle><CardDescription>Catatan akumulasi pelanggaran dan tingkat perhatian siswa.</CardDescription></div></div><Button onClick={() => setOpen(true)}><Plus className="size-4" />Tambah Poin</Button></div></CardHeader><CardContent className="space-y-5"><div className="grid gap-5 lg:grid-cols-[260px_1fr]"><div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-muted/20 p-5"><div className="relative size-40"><svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={`${summary.totalPoints} poin pelanggaran, level ${summary.level.label}`}><circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="10" /><circle cx="60" cy="60" r="50" fill="none" stroke={summary.level.color} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset} /></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><strong className="text-4xl tabular-nums">{summary.totalPoints}</strong><span className="text-xs text-muted-foreground">poin</span></div></div><Badge className={`mt-3 border-0 ${summary.level.softColor}`}>{summary.level.label}</Badge><p className="mt-2 text-center text-xs text-muted-foreground">Warna berubah sesuai akumulasi: hijau, biru, kuning, oranye, lalu merah.</p></div><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-border/60 p-4"><p className="text-sm text-muted-foreground">Poin bulan berjalan</p><p className="mt-1 text-2xl font-bold tabular-nums">{summary.currentMonthPoints}</p></div><div className="rounded-xl border border-border/60 p-4"><p className="text-sm text-muted-foreground">Jumlah kejadian</p><p className="mt-1 text-2xl font-bold tabular-nums">{summary.recordCount}</p></div></div><div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Pelanggaran</TableHead><TableHead className="text-center">Poin</TableHead><TableHead>Catatan</TableHead><TableHead>Dicatat oleh</TableHead></TableRow></TableHeader><TableBody>{records.length === 0 ? <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">Belum ada poin pelanggaran.</TableCell></TableRow> : records.map(record => <TableRow key={record.id}><TableCell className="whitespace-nowrap">{formatDate(record.occurredAt)}</TableCell><TableCell className="font-medium">{record.category}</TableCell><TableCell className="text-center"><Badge variant="secondary">+{record.points}</Badge></TableCell><TableCell className="max-w-56 whitespace-normal text-muted-foreground">{record.note || "—"}</TableCell><TableCell><ProfileNameLink type="teacher" id={record.recordedBy.id} name={record.recordedBy.name} /></TableCell></TableRow>)}</TableBody></Table></div></div></div></CardContent>

    <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value) }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Tambah Poin Pelanggaran</DialogTitle><DialogDescription>Catat jenis pelanggaran, poin, tanggal kejadian, dan keterangan pendukung.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-1.5"><Label htmlFor="point-category">Jenis pelanggaran</Label><Select value={category} onValueChange={(value) => { if (!value) return; setCategory(value); const item=categories.find(([name])=>name===value); if(item) setPoints(String(item[1])) }}><SelectTrigger id="point-category" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{categories.map(([name,value])=><SelectItem key={name} value={name}>{name} — {value} poin</SelectItem>)}</SelectContent></Select></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="point-value">Jumlah poin</Label><Input id="point-value" type="number" min={1} max={100} value={points} onChange={event=>setPoints(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="point-date">Tanggal kejadian</Label><Input id="point-date" type="date" value={occurredAt} onChange={event=>setOccurredAt(event.target.value)} /></div></div><div className="space-y-1.5"><Label htmlFor="point-note">Catatan</Label><textarea id="point-note" maxLength={500} value={note} onChange={event=>setNote(event.target.value)} placeholder="Keterangan tambahan (opsional)" className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" /></div><div className="flex gap-2 rounded-xl bg-[var(--chart-4)]/10 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--chart-4)]" /><p>Poin akan langsung masuk ke riwayat siswa dan memengaruhi warna diagram.</p></div></div><DialogFooter><DialogClose render={<Button variant="outline" disabled={saving} />}>Batal</DialogClose><Button onClick={save} disabled={saving || !category || !occurredAt || Number(points)<1 || Number(points)>100}>{saving?<Loader2 className="size-4 animate-spin"/>:null}{saving?"Menyimpan...":"Simpan Poin"}</Button></DialogFooter></DialogContent></Dialog>
  </Card>
}

function formatDate(date: Date) { return formatSchoolDate(fromPrismaDate(date), { day: "numeric", month: "short", year: "numeric" }) }

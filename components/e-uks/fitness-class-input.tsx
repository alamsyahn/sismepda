"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FITNESS_NORM_URL, FITNESS_PROTOCOLS, FITNESS_STATUSES, fitnessBatchSchema, fitnessCategory, sameFitnessInput, type FitnessInputRow, type FitnessProtocol, type FitnessRosterRow, type FitnessStatus } from "@/lib/fitness"

type Props = {
  classes: { id: string; name: string }[]; classId: string; testedAt: string;
  data: { today: string; session: { protocol: FitnessProtocol; audioLabel: string } | null; rows: FitnessRosterRow[]; canCreate: boolean; canUpdate: boolean }
}
const fieldClass = "min-h-11 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60"
function initial(row: FitnessRosterRow): FitnessInputRow {
  return row.result ?? { studentId: row.id, version: 0, status: "NOT_TESTED", level: null, shuttle: null, note: "" }
}
export function FitnessClassInput({ classes, classId, testedAt, data }: Props) {
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, FitnessInputRow>>(() => Object.fromEntries(data.rows.map(r => [r.id, initial(r)])))
  const [baseline, setBaseline] = useState(draft)
  const [protocol, setProtocol] = useState<FitnessProtocol>(data.session?.protocol ?? "BEEP_20M_OTHER")
  const [audioLabel, setAudioLabel] = useState(data.session?.audioLabel ?? "")
  const [filterClass, setFilterClass] = useState(classId)
  const [filterDate, setFilterDate] = useState(testedAt)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const dirty = data.rows.filter(r => !sameFitnessInput(baseline[r.id], draft[r.id]))
  const visible = data.rows.filter(r => r.name.toLocaleLowerCase("id").includes(query.toLocaleLowerCase("id")) && (statusFilter === "ALL" || draft[r.id].status === statusFilter))
  const testedCount = data.rows.filter(r => draft[r.id].status === "TESTED").length
  function update(id: string, change: Partial<FitnessInputRow>) {
    setDraft(current => ({ ...current, [id]: { ...current[id], ...change } }))
    setError(""); setMessage("")
  }
  async function save() {
    const parsed = fitnessBatchSchema.safeParse({ classId, testedAt, protocol, audioLabel, rows: dirty.map(r => {
      const d = draft[r.id]
      return { studentId: r.id, version: d.version, status: d.status, level: d.level, shuttle: d.shuttle, note: d.note }
    }) })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Periksa isian."); return }
    setBusy(true); setError(""); setMessage("")
    try {
      const response = await fetch("/api/e-uks/fitness", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Gagal menyimpan catatan.")
      const saved = { ...draft }
      for (const row of parsed.data.rows) saved[row.studentId] = { ...row, version: result.versions[row.studentId] }
      setDraft(saved); setBaseline(saved)
      setMessage(`${result.changed} perubahan disimpan.`)
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan. Isian tetap tersedia.") }
    finally { setBusy(false) }
  }
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>Kelas dan pelaksanaan tes</CardTitle></CardHeader><CardContent>
      <form className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={e => {
        e.preventDefault()
        if (dirty.length && !window.confirm("Ada perubahan yang belum disimpan. Pindah kelas/tanggal dan abaikan perubahan?")) return
        router.push(`/e-uks/kebugaran?${new URLSearchParams({ classId: filterClass, testedAt: filterDate })}`)
      }}>
        <label className="space-y-2 text-sm">Kelas<select className={fieldClass} value={filterClass} onChange={e => setFilterClass(e.target.value)} disabled={busy}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="space-y-2 text-sm">Tanggal tes<Input type="date" value={filterDate} max={data.today} required disabled={busy} onChange={e => setFilterDate(e.target.value)} /></label>
        <Button type="submit" variant="outline" disabled={busy}>Tampilkan</Button>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Beep Test · 20 meter</CardTitle><p className="text-sm text-muted-foreground">Isi level dan balikan terakhir yang berhasil diselesaikan. Tes ini mencatat daya tahan aerobik.</p></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">Protokol / norma<select className={fieldClass} value={protocol} disabled={busy || !!data.session || !data.canCreate} onChange={e => setProtocol(e.target.value as FitnessProtocol)}>{Object.entries(FITNESS_PROTOCOLS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label className="space-y-2 text-sm">Nama / versi audio<Input value={audioLabel} maxLength={160} placeholder="Contoh: Audio resmi TKSI Fase D — versi sekolah 2026" disabled={busy || !!data.session || !data.canCreate} onChange={e => setAudioLabel(e.target.value)} /></label>
      </div>
      <p className="text-xs text-muted-foreground">Pilih TKSI hanya jika pelaksanaan dan audio mengikuti <a className="underline" href={FITNESS_NORM_URL} target="_blank" rel="noreferrer">panduan TKSI Fase D</a>. Audio lain dicatat tanpa kategori. Protokol dan audio dikunci setelah penyimpanan pertama agar hasil tetap sebanding.</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm font-medium">{testedCount} dari {data.rows.length} siswa berstatus sudah tes {dirty.length > 0 && <span className="text-primary">· {dirty.length} perubahan belum disimpan</span>}</p>
        <div className="flex flex-wrap gap-2"><Input aria-label="Cari nama siswa" placeholder="Cari nama siswa…" value={query} onChange={e => setQuery(e.target.value)} className="w-52" /><select aria-label="Filter status tes" className={`${fieldClass} w-auto`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="ALL">Semua status</option>{Object.entries(FITNESS_STATUSES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <Table><TableHeader><TableRow><TableHead>Nama siswa</TableHead><TableHead>Status</TableHead><TableHead>Level</TableHead><TableHead>Balikan</TableHead><TableHead>Kategori beep test</TableHead><TableHead>Catatan</TableHead></TableRow></TableHeader><TableBody>
        {visible.map(row => {
          const value = draft[row.id]
          const disabled = busy || (row.result ? !data.canUpdate : !data.canCreate)
          const category = fitnessCategory({ ...value, protocol, genderAtTest: row.result?.genderAtTest ?? row.gender, gradeAtTest: row.result?.gradeAtTest ?? row.grade })
          return <TableRow key={row.id} className={dirty.some(r => r.id === row.id) ? "bg-primary/5" : undefined}>
            <TableCell className="min-w-44 font-medium">{row.name}{row.result && <span className="mt-1 block text-xs font-normal text-muted-foreground">Pencatat: {row.result.recordedByName}</span>}</TableCell>
            <TableCell><select aria-label={`Status ${row.name}`} className={`${fieldClass} min-w-36`} value={value.status} disabled={disabled} onChange={e => { const status = e.target.value as FitnessStatus; update(row.id, { status, ...(status !== "TESTED" ? { level: null, shuttle: null } : {}) }) }}>{Object.entries(FITNESS_STATUSES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></TableCell>
            <TableCell><Input aria-label={`Level ${row.name}`} type="number" inputMode="numeric" min={1} max={21} step={1} value={value.level ?? ""} disabled={disabled || value.status !== "TESTED"} className="min-w-20" onChange={e => update(row.id, { level: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
            <TableCell><Input aria-label={`Balikan ${row.name}`} type="number" inputMode="numeric" min={1} max={30} step={1} value={value.shuttle ?? ""} disabled={disabled || value.status !== "TESTED"} className="min-w-20" onChange={e => update(row.id, { shuttle: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
            <TableCell className="min-w-40 text-sm">{category}</TableCell>
            <TableCell><Input aria-label={`Catatan ${row.name}`} value={value.note} disabled={disabled} maxLength={1000} className="min-w-52" placeholder="Opsional" onChange={e => update(row.id, { note: e.target.value })} /></TableCell>
          </TableRow>
        })}
        {!visible.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{data.rows.length ? "Tidak ada siswa sesuai pencarian." : "Belum ada siswa aktif di kelas ini."}</TableCell></TableRow>}
      </TableBody></Table>
      <p className="text-xs text-muted-foreground">Baris yang belum diisi tetap belum tes, bukan nilai nol. Level dan balikan disimpan terpisah. Kolom tabel dapat digeser pada layar kecil.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm text-primary">{message}</p>}
      {(data.canCreate || data.canUpdate) && <div className="flex justify-end"><Button disabled={busy || !dirty.length} onClick={() => void save()}>{busy ? "Menyimpan…" : `Simpan ${dirty.length} perubahan`}</Button></div>}
    </CardContent></Card>
  </div>
}

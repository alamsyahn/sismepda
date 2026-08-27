"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarDays, CheckCircle2, Clock, Grid3X3, ListChecks, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { DateFilter } from "@/components/date-filter"
import { formatLongDate, localDateValue } from "@/lib/date"
import { StatusPill } from "@/components/dashboard/status-pill"
import { grades_list, type ClassRecord } from "@/lib/dashboard-data"
import { ExportButton } from "@/components/export/export-button"
import { ClassPeriodRecap } from "@/components/rekap/class-period-recap"

const gradeOptions = [{ value: "all", label: "Semua Tingkat" }, ...grades_list.map((g) => ({ value: g, label: `Tingkat ${g}` }))]
type Mode = "daily" | "cumulative" | "matrix"

export default function RekapKelasPage() {
  const [classes, setClasses] = useState<ClassRecord[]>([])
  const [holiday, setHoliday] = useState<{ id: string; name: string } | null>(null)
  const [date, setDate] = useState(localDateValue())
  const [grade, setGrade] = useState("all")
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<Mode>("daily")
  useEffect(() => { fetch(`/api/dashboard?date=${date}`).then((r) => r.json()).then((data) => { setClasses(data.classes ?? []); setHoliday(data.holiday ?? null) }) }, [date])
  const filtered = useMemo(() => classes.filter((c) => (grade === "all" || c.grade === grade) && (!query.trim() || c.name.toLowerCase().includes(query.toLowerCase()) || c.homeroom.toLowerCase().includes(query.toLowerCase()))), [classes, grade, query])
  const classOptions = useMemo(() => classes.map((item) => ({ id: item.id, name: item.name })), [classes])

  return <PageContainer>
    <PageHeading title="Rekap Kelas" description={mode === "daily" ? `Rincian kehadiran dan status input pada ${formatLongDate(date)}.` : "Rekap ketidakhadiran siswa berdasarkan kelas dan rentang tanggal."}
      action={mode === "daily" ? <><DateFilter value={date} onChange={setDate} ariaLabel="Tanggal rekap kelas"/><ExportButton type="attendance_classes" params={{ date, grade, query }}/></> : undefined}/>
    <div className="mb-5 flex w-fit flex-wrap rounded-xl bg-muted p-1">
      <ModeButton active={mode === "daily"} onClick={() => setMode("daily")} icon={<CalendarDays/>}>Ringkasan Harian</ModeButton>
      <ModeButton active={mode === "cumulative"} onClick={() => setMode("cumulative")} icon={<ListChecks/>}>Kumulatif</ModeButton>
      <ModeButton active={mode === "matrix"} onClick={() => setMode("matrix")} icon={<Grid3X3/>}>Matriks Tanggal</ModeButton>
    </div>

    {mode !== "daily" ? <ClassPeriodRecap mode={mode} classes={classOptions}/> : holiday ? (
      <Card className="border-primary/30 bg-primary/5"><CardContent className="py-12 text-center"><p className="text-lg font-semibold">Hari Libur</p><p className="text-sm text-muted-foreground">{holiday.name}. Tidak ada kewajiban input absensi pada tanggal ini.</p></CardContent></Card>
    ) : <DailyRecap classes={filtered} grade={grade} setGrade={setGrade} query={query} setQuery={setQuery}/>} 
  </PageContainer>
}

function ModeButton({active,onClick,icon,children}:{active:boolean;onClick:()=>void;icon:React.ReactNode;children:React.ReactNode}) {
  return <Button variant={active ? "secondary" : "ghost"} size="sm" onClick={onClick} aria-pressed={active} className={active ? "bg-card shadow-sm" : "text-muted-foreground"}><span className="[&_svg]:size-4">{icon}</span>{children}</Button>
}

function DailyRecap({classes,grade,setGrade,query,setQuery}:{classes:ClassRecord[];grade:string;setGrade:(v:string)=>void;query:string;setQuery:(v:string)=>void}) {
  return <div className="space-y-5">
    <Card className="border-border/70"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Cari kelas atau wali kelas..." className="bg-card pl-9"/></div>
      <Select value={grade} onValueChange={(v)=>v&&setGrade(v)}><SelectTrigger className="w-full bg-card sm:w-48"><SelectValue>{(value:string)=>gradeOptions.find((o)=>o.value===value)?.label??"Pilih tingkat"}</SelectValue></SelectTrigger><SelectContent>{gradeOptions.map((o)=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
    </CardContent></Card>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{classes.map((c)=><Card key={c.id} className="border-border/70"><CardContent className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-bold">{c.name}</p><p className="text-sm text-muted-foreground">{c.homeroom}</p></div>{c.submitted?<span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--chart-1)]/12 px-2.5 py-1 text-xs font-medium text-[var(--chart-1)]"><CheckCircle2 className="size-3.5"/>{c.submittedAt}</span>:<span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--chart-5)]/12 px-2.5 py-1 text-xs font-medium text-[var(--chart-5)]"><Clock className="size-3.5"/>Belum input</span>}</div>
      {c.submitted?<><div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Kehadiran</span><span className="text-sm font-semibold">{c.hadir}/{c.totalStudents} siswa</span></div><div className="flex flex-wrap gap-1.5"><StatusPill status="hadir" count={c.hadir}/><StatusPill status="sakit" count={c.sakit}/><StatusPill status="izin" count={c.izin}/><StatusPill status="dispensasi" count={c.dispensasi}/><StatusPill status="alfa" count={c.alfa}/></div></>:<p className="rounded-lg bg-secondary/60 px-3 py-6 text-center text-sm text-muted-foreground">{c.totalStudents} siswa · absensi belum diinput pada tanggal ini</p>}
    </CardContent></Card>)}</div>
    {classes.length===0?<p className="py-12 text-center text-sm text-muted-foreground">Tidak ada kelas yang cocok dengan pencarian.</p>:null}
  </div>
}

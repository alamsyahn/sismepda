"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { Download, Info, Loader2, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { tableRowNumber } from "@/lib/table-row-number"

type Row = { id:string; nis:string|null; nisn:string|null; name:string; codes:string[]; statuses:string[]; counts:{hadir:number;sakit:number;izin:number;dispensasi:number;alfa:number}; totalAbsent:number }
type Recap = { schoolClass:{id:string;name:string;homeroom:string}; from:string; to:string; dates:Array<{value:string;day:number;weekday:string;holiday:string|null;submitted:boolean}>; rows:Row[]; cumulativeRows:Row[]; schoolDayCount:number; submittedDayCount:number }
const codeTone:Record<string,string>={A:"bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",S:"bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",I:"bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",D:"bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300","—":"text-muted-foreground","·":"bg-muted text-muted-foreground",L:"bg-primary/10 text-primary"}

export function ClassPeriodRecap({ mode, classes, initialClassId }:{mode:"cumulative"|"matrix";classes:Array<{id:string;name:string}>;initialClassId?:string|null}) {
  const jakartaToday=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
  const [year,month]=jakartaToday.split("-")
  const [classId,setClassId]=useState(initialClassId??classes[0]?.id??""); const [from,setFrom]=useState(`${year}-${month}-01`); const [to,setTo]=useState(jakartaToday)
  const [query,setQuery]=useState(""); const [onlyAbsent,setOnlyAbsent]=useState(false); const [data,setData]=useState<Recap|null>(null); const [error,setError]=useState(""); const [loading,setLoading]=useState(false)
  const requestSequence=useRef(0)
  useEffect(()=>{if(!classId)return; const sequence=++requestSequence.current; const controller=new AbortController(); setLoading(true);setError("");setData(null); fetch(`/api/class-recap?classId=${encodeURIComponent(classId)}&from=${from}&to=${to}`,{signal:controller.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(v.error);if(sequence===requestSequence.current)setData(v)}).catch(e=>{if(e.name!=="AbortError"&&sequence===requestSequence.current)setError(e.message)}).finally(()=>{if(sequence===requestSequence.current)setLoading(false)});return()=>controller.abort()},[classId,from,to])
  const rows=useMemo(()=>{const source=mode==="cumulative"?(data?.cumulativeRows??[]):(data?.rows??[]);const needle=query.trim().toLowerCase();return source.filter(r=>(!onlyAbsent||r.totalAbsent>0)&&(!needle||r.name.toLowerCase().includes(needle)||r.nis?.includes(needle)||r.nisn?.includes(needle)))},[data,mode,query,onlyAbsent])
  const exportUrl=`/api/class-recap/export?classId=${encodeURIComponent(classId)}&from=${from}&to=${to}&mode=${mode}`
  return <div className="space-y-4">
    <Card className="border-border/70"><CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[220px_170px_170px_1fr_auto]">
      <div className="space-y-1.5"><Label htmlFor={`${mode}-class`}>Kelas</Label><Select value={classId} onValueChange={v=>v&&setClassId(v)}><SelectTrigger id={`${mode}-class`} className="w-full"><SelectValue>{(value:string)=>classes.find((item)=>item.id===value)?.name??"Pilih kelas"}</SelectValue></SelectTrigger><SelectContent>{classes.map(c=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor={`${mode}-from`}>Tanggal mulai</Label><Input id={`${mode}-from`} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
      <div className="space-y-1.5"><Label htmlFor={`${mode}-to`}>Tanggal akhir</Label><Input id={`${mode}-to`} type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
      <div className="space-y-1.5"><Label htmlFor={`${mode}-search`}>Cari siswa</Label><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input id={`${mode}-search`} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nama, NIS, atau NISN" className="pl-9"/></div></div>
      <div className="flex items-end"><Button render={<a href={exportUrl}/>} nativeButton={false} disabled={!data||loading}><Download className="size-4"/>Export Excel</Button></div>
    </CardContent></Card>
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyAbsent} onChange={e=>setOnlyAbsent(e.target.checked)} className="size-4 accent-primary"/>Hanya siswa yang pernah tidak hadir</label>{data?<p className="text-sm text-muted-foreground">{data.schoolDayCount} hari sekolah · {data.submittedDayCount} hari sudah diinput</p>:null}</div>
    {error?<Card className="border-destructive/40" role="alert"><CardContent className="flex gap-2 p-5 text-sm text-destructive"><Info className="size-4 shrink-0"/>{error}</CardContent></Card>:null}
    {loading?<div className="flex h-48 items-center justify-center text-muted-foreground" role="status" aria-live="polite"><Loader2 className="mr-2 size-5 animate-spin"/>Memuat rekap...</div>:null}
    {!loading&&data&&mode==="cumulative"?<Cumulative rows={rows}/>:null}
    {!loading&&data&&mode==="matrix"?<Matrix rows={rows} dates={data.dates}/>:null}
    <div className="flex flex-wrap gap-2 text-xs"><Legend code="—" label="Hadir"/><Legend code="A" label="Alfa"/><Legend code="S" label="Sakit"/><Legend code="I" label="Izin"/><Legend code="D" label="Dispensasi"/><Legend code="·" label="Belum input"/><Legend code="L" label="Libur"/></div>
  </div>
}
function Cumulative({rows}:{rows:Row[]}){return <Card><CardContent className="overflow-x-auto p-0"><Table><TableHeader><TableRow><TableHead className="w-12 text-center">No</TableHead><TableHead>Siswa</TableHead><TableHead>NIS</TableHead>{["Hadir","Sakit","Izin","Disp.","Alfa","Total Tidak Hadir"].map(h=><TableHead key={h} className="text-center">{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length?rows.map((r,index)=><TableRow key={r.id}><TableCell className="text-center text-muted-foreground tabular-nums">{tableRowNumber(index)}</TableCell><TableCell className="font-medium"><Link href={`/siswa/${r.id}`} className="hover:text-primary hover:underline">{r.name}</Link></TableCell><TableCell className="font-mono text-muted-foreground">{r.nis??"-"}</TableCell><N n={r.counts.hadir}/><N n={r.counts.sakit}/><N n={r.counts.izin}/><N n={r.counts.dispensasi}/><N n={r.counts.alfa}/><TableCell className="text-center font-bold">{r.totalAbsent}</TableCell></TableRow>):<TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">Tidak ada siswa yang sesuai.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>}
function N({n}:{n:number}){return <TableCell className="text-center tabular-nums">{n}</TableCell>}
function Matrix({rows,dates}:{rows:Row[];dates:Recap["dates"]}){return <Card><CardContent className="max-h-[70vh] overflow-auto p-0"><Table className="border-separate border-spacing-0"><TableHeader><TableRow><TableHead className="sticky left-0 top-0 z-30 w-12 min-w-12 bg-card text-center">No</TableHead><TableHead className="sticky left-12 top-0 z-30 min-w-52 bg-card">Siswa</TableHead>{dates.map(d=><TableHead key={d.value} title={d.holiday??d.value} className={cn("sticky top-0 z-20 w-10 min-w-10 px-1 text-center",d.holiday?"bg-primary/10":"bg-card")}><span className="block text-[10px] font-normal">{d.weekday}</span>{String(d.day).padStart(2,"0")}</TableHead>)}<TableHead className="sticky right-0 top-0 z-30 bg-card text-center">Total</TableHead></TableRow></TableHeader><TableBody>{rows.map((r,index)=><TableRow key={r.id}><TableCell className="sticky left-0 z-10 bg-card text-center text-muted-foreground tabular-nums">{tableRowNumber(index)}</TableCell><TableCell className="sticky left-12 z-10 bg-card font-medium"><Link href={`/siswa/${r.id}`} className="hover:text-primary hover:underline">{r.name}</Link></TableCell>{r.codes.map((code,i)=><TableCell key={dates[i].value} title={`${dates[i].value}: ${r.statuses[i]}`} className="p-1 text-center"><span className={cn("inline-flex size-7 items-center justify-center rounded-md font-semibold",codeTone[code])}>{code}</span></TableCell>)}<TableCell className="sticky right-0 z-10 bg-card text-center font-bold">{r.totalAbsent}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
function Legend({code,label}:{code:string;label:string}){return <Badge variant="outline" className="gap-1.5"><span className={cn("inline-flex size-5 items-center justify-center rounded text-[10px]",codeTone[code])}>{code}</span>{label}</Badge>}

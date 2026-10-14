"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FITNESS_NORM_URL, FITNESS_PROTOCOLS, FITNESS_STATUSES, fitnessCategory, type FitnessResultView } from "@/lib/fitness"
import { formatSchoolDate, requireSchoolDate } from "@/lib/school-date"

function Trend({ rows }: { rows: FitnessResultView[] }) {
  const points = [...rows].sort((a,b) => a.testedAt.localeCompare(b.testedAt))
  if (points.length < 2) return <p className="text-sm text-muted-foreground">Grafik tersedia setelah dua hasil tes valid dengan protokol dan audio yang sama.</p>
  const width = 680, height = 210, pad = 40
  const max = Math.max(2, ...points.map(p => p.level!))
  const times = points.map(p => Date.parse(`${p.testedAt}T00:00:00Z`))
  const span = times[times.length-1] - times[0] || 1
  const x = (i: number) => pad + (times[i] - times[0]) / span * (width - pad * 2)
  const y = (p: FitnessResultView) => height - pad - p.level! / max * (height - pad * 2)
  return <div className="space-y-2"><p className="text-sm font-medium">{FITNESS_PROTOCOLS[points[0].protocol]} · {points[0].audioLabel}</p>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik perkembangan level beep test" className="w-full">
      {[0, Math.ceil(max/2), max].map(v => <g key={v}><line x1={pad} x2={width-pad} y1={height-pad-v/max*(height-pad*2)} y2={height-pad-v/max*(height-pad*2)} stroke="currentColor" opacity="0.12" /><text x={8} y={height-pad-v/max*(height-pad*2)+4} fontSize="11" fill="currentColor">L{v}</text></g>)}
      <polyline points={points.map((p,i) => `${x(i)},${y(p)}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth={2.5} />
      {points.map((p,i) => <g key={p.id}><circle cx={x(i)} cy={y(p)} r={5} fill="var(--primary)" tabIndex={0}><title>{formatSchoolDate(requireSchoolDate(p.testedAt))}: Level {p.level}, balikan {p.shuttle}</title></circle>{(i === 0 || i === points.length-1) && <text x={x(i)} y={height-12} textAnchor={i === 0 ? "start" : "end"} fontSize="11" fill="currentColor">{formatSchoolDate(requireSchoolDate(p.testedAt))}</text>}</g>)}
    </svg><p className="text-xs text-muted-foreground">Sumbu vertikal menunjukkan level. Balikan tercantum pada titik dan tabel riwayat. Hanya hasil valid dengan audio yang sama dihubungkan.</p>
  </div>
}
export function FitnessStudentCard({ results, classId }: { results: FitnessResultView[]; classId: string }) {
  const valid = results.filter(r => r.status === "TESTED")
  const latest = valid[0]
  const groups = Object.values(valid.reduce<Record<string, FitnessResultView[]>>((all,r) => {
    const key = JSON.stringify([r.protocol, r.audioLabel]); (all[key] ??= []).push(r); return all
  }, {}))
  return <Card><CardHeader><CardTitle>Catatan Kebugaran</CardTitle><p className="text-sm text-muted-foreground">Beep test menilai daya tahan aerobik. Kategori ini bukan nilai kebugaran keseluruhan atau skor TKSI lengkap.</p></CardHeader><CardContent className="space-y-5">
    {latest ? <div className="rounded-lg bg-primary/5 p-4"><p className="text-xs text-muted-foreground">Hasil tes valid terakhir · {formatSchoolDate(requireSchoolDate(latest.testedAt))}</p><p className="mt-1 text-xl font-semibold">Level {latest.level} · Balikan {latest.shuttle}</p><p className="mt-1 text-sm">{fitnessCategory(latest)}</p></div> : <p className="py-4 text-sm text-muted-foreground">Belum ada hasil beep test valid untuk siswa ini.</p>}
    {groups.length ? groups.map(group => <Trend key={JSON.stringify([group[0].protocol, group[0].audioLabel])} rows={group} />) : null}
    {results.length > 0 && <Table><TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Status</TableHead><TableHead>Hasil</TableHead><TableHead>Kategori beep test</TableHead><TableHead>Pelaksanaan / pencatat</TableHead><TableHead>Catatan</TableHead></TableRow></TableHeader><TableBody>{results.map(r => <TableRow key={r.id}>
      <TableCell className="whitespace-nowrap">{formatSchoolDate(requireSchoolDate(r.testedAt))}</TableCell><TableCell>{FITNESS_STATUSES[r.status]}</TableCell><TableCell className="whitespace-nowrap">{r.status === "TESTED" ? `L${r.level} · B${r.shuttle}` : "—"}</TableCell><TableCell>{fitnessCategory(r)}</TableCell><TableCell className="min-w-44 text-xs">{FITNESS_PROTOCOLS[r.protocol]}<br />{r.audioLabel}<br />{r.recordedByName}</TableCell><TableCell className="max-w-64 whitespace-normal break-words">{r.note || "—"}</TableCell>
    </TableRow>)}</TableBody></Table>}
    <div className="flex flex-wrap justify-between gap-3 text-sm"><a href={FITNESS_NORM_URL} target="_blank" rel="noreferrer" className="text-primary underline">Sumber norma: TKSI Fase D (2023)</a><Link href={`/e-uks/kebugaran?${new URLSearchParams({ classId })}`} className="text-primary underline">Buka pencatatan per kelas →</Link></div>
    <p className="text-xs text-muted-foreground">Kategori hanya tersedia untuk protokol TKSI Fase D dan data yang memenuhi syarat. Rentang yang tidak tercantum jelas di sumber ditandai perlu verifikasi. VO₂max tidak dihitung tanpa rumus yang disepakati.</p>
  </CardContent></Card>
}

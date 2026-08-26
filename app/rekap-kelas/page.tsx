"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, CheckCircle2, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { DateFilter } from "@/components/date-filter"
import { formatLongDate, localDateValue } from "@/lib/date"
import { StatusPill } from "@/components/dashboard/status-pill"
import { grades_list, type ClassRecord } from "@/lib/dashboard-data"
import { ExportButton } from "@/components/export/export-button"

const gradeOptions = [
  { value: "all", label: "Semua Tingkat" },
  ...grades_list.map((g) => ({ value: g, label: `Tingkat ${g}` })),
]

export default function RekapKelasPage() {
  const [classes, setClasses] = useState<ClassRecord[]>([])
  const [holiday, setHoliday] = useState<{ id: string; name: string } | null>(null)
  const [date, setDate] = useState(localDateValue())
  const [grade, setGrade] = useState("all")
  const [query, setQuery] = useState("")
  useEffect(() => { fetch(`/api/dashboard?date=${date}`).then((r) => r.json()).then((data) => { setClasses(data.classes); setHoliday(data.holiday) }) }, [date])

  const filtered = useMemo(() => {
    return classes.filter((c) => {
      const matchGrade = grade === "all" || c.grade === grade
      const matchQuery =
        query.trim() === "" ||
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.homeroom.toLowerCase().includes(query.toLowerCase())
      return matchGrade && matchQuery
    })
  }, [classes, grade, query])

  if (holiday) return <PageContainer><PageHeading title="Rekap Kelas" description={`Rincian kehadiran dan status input absensi pada ${formatLongDate(date)}.`} action={<><DateFilter value={date} onChange={setDate} ariaLabel="Tanggal rekap kelas" /><ExportButton type="attendance_classes" params={{ date, grade, query }} /></>} /><Card className="border-primary/30 bg-primary/5"><CardContent className="py-12 text-center"><p className="text-lg font-semibold">Hari Libur</p><p className="text-sm text-muted-foreground">{holiday.name}. Tidak ada kewajiban input absensi pada tanggal ini.</p></CardContent></Card></PageContainer>

  return (
    <PageContainer>
      <PageHeading
        title="Rekap Kelas"
        description={`Rincian kehadiran dan status input absensi pada ${formatLongDate(date)}.`}
        action={<><DateFilter value={date} onChange={setDate} ariaLabel="Tanggal rekap kelas" /><ExportButton type="attendance_classes" params={{ date, grade, query }} /></>}
      />

      <Card className="border-border/70">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kelas atau wali kelas..."
              className="bg-card pl-9"
            />
          </div>
          <Select value={grade} onValueChange={(value) => value && setGrade(value)}>
            <SelectTrigger className="w-full bg-card sm:w-48">
              <SelectValue>
                {(value: string) =>
                  gradeOptions.find((o) => o.value === value)?.label ?? "Pilih tingkat"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {gradeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c) => (
          <Card key={c.id} className="border-border/70">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-foreground">{c.name}</p>
                  <p className="text-sm text-muted-foreground">{c.homeroom}</p>
                </div>
                {c.submitted ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--chart-1)]/12 px-2.5 py-1 text-xs font-medium text-[var(--chart-1)]">
                    <CheckCircle2 className="size-3.5" />
                    {c.submittedAt}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--chart-5)]/12 px-2.5 py-1 text-xs font-medium text-[var(--chart-5)]">
                    <Clock className="size-3.5" />
                    Belum input
                  </span>
                )}
              </div>

              {c.submitted ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Kehadiran</span>
                    <span className="text-sm font-semibold text-foreground">
                      {c.hadir}/{c.totalStudents} siswa
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusPill status="hadir" count={c.hadir} />
                    <StatusPill status="sakit" count={c.sakit} />
                    <StatusPill status="izin" count={c.izin} />
                    <StatusPill status="dispensasi" count={c.dispensasi} />
                    <StatusPill status="alfa" count={c.alfa} />
                  </div>
                </>
              ) : (
                <p className="rounded-lg bg-secondary/60 px-3 py-6 text-center text-sm text-muted-foreground">
                  {`${c.totalStudents} siswa`} &middot; absensi belum diinput pada tanggal ini
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Tidak ada kelas yang cocok dengan pencarian.
        </p>
      ) : null}
    </PageContainer>
  )
}

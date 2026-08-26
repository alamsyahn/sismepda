"use client"

import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { DateFilter } from "@/components/date-filter"
import { formatLongDate, localDateValue } from "@/lib/date"
import { StatusPill } from "@/components/dashboard/status-pill"
import type { StudentRow } from "@/lib/dashboard-data"
import { ExportButton } from "@/components/export/export-button"

const PAGE_SIZE = 15

export default function RekapSiswaPage() {
  const [students, setStudents] = useState<StudentRow[]>([])
  const [classes, setClasses] = useState<string[]>([])
  const [holiday, setHoliday] = useState<{ id: string; name: string } | null>(null)
  const [date, setDate] = useState(localDateValue())
  const [cls, setCls] = useState("all")
  const [query, setQuery] = useState("")
  const [visible, setVisible] = useState(PAGE_SIZE)
  useEffect(() => { fetch(`/api/recap-students?date=${date}`).then((r) => r.json()).then((data) => { setStudents(data.students); setClasses(data.classes); setHoliday(data.holiday) }) }, [date])
  const classFilterOptions = useMemo(() => [{ value: "all", label: "Semua Kelas" }, ...classes.map((name) => ({ value: name, label: name }))], [classes])

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const matchCls = cls === "all" || s.className === cls
      const matchQuery =
        query.trim() === "" || s.name.toLowerCase().includes(query.toLowerCase()) || s.nis?.includes(query) || s.nisn?.includes(query)
      return matchCls && matchQuery
    })
  }, [students, cls, query])

  const shown = filtered.slice(0, visible)

  function resetVisible<T>(fn: (v: T) => void) {
    return (v: T) => {
      setVisible(PAGE_SIZE)
      fn(v)
    }
  }

  return (
    <PageContainer>
      <PageHeading
        title="Rekap Siswa"
        description={`Rekap kehadiran kumulatif beserta status pada ${formatLongDate(date)}.`}
        action={<><DateFilter value={date} onChange={setDate} ariaLabel="Tanggal status siswa" /><ExportButton type="attendance_students" params={{ date, class: cls, query }} /></>}
      />

      <Card className="border-border/70">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => resetVisible(setQuery)(e.target.value)}
              placeholder="Cari nama, NIS, atau NISN..."
              className="bg-card pl-9"
            />
          </div>
          <Select value={cls} onValueChange={(value) => value && resetVisible(setCls)(value)}>
            <SelectTrigger className="w-full bg-card sm:w-44">
              <SelectValue>
                {(value: string) =>
                  classFilterOptions.find((o) => o.value === value)?.label ?? "Pilih kelas"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {classFilterOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-48">Nama Siswa</TableHead>
                  <TableHead>NIS</TableHead>
                  <TableHead>NISN</TableHead>
                  <TableHead>Kelas</TableHead>
                  <TableHead className="text-center">Hadir</TableHead>
                  <TableHead className="text-center">Sakit</TableHead>
                  <TableHead className="text-center">Izin</TableHead>
                  <TableHead className="text-center">Disp.</TableHead>
                  <TableHead className="text-center">Alfa</TableHead>
                  <TableHead>Status Tanggal Dipilih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{s.nis ?? "-"}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{s.nisn ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.className}</TableCell>
                    <TableCell className="text-center font-semibold text-[var(--chart-1)]">
                      {s.hadir}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{s.sakit}</TableCell>
                    <TableCell className="text-center text-muted-foreground">{s.izin}</TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {s.dispensasi}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{s.alfa}</TableCell>
                    <TableCell>
                      {holiday ? <span className="text-sm font-medium text-primary">Libur</span> : s.todayStatus ? <StatusPill status={s.todayStatus} /> : <span className="text-sm text-muted-foreground">Belum diinput</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Menampilkan {shown.length} dari {filtered.length} siswa
        </p>
        {visible < filtered.length ? (
          <button
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Muat lebih banyak
          </button>
        ) : null}
      </div>
    </PageContainer>
  )
}

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Download, Search, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { tableRowNumber } from "@/lib/table-row-number"

export type DirectoryEntry = {
  id: string
  name: string
  nip: string | null
  email: string | null
  phone: string | null
  active: boolean
  employmentStatus: string | null
  position: string | null
  teachingSince: string | null
  homeroom: string | null
  subjects: string[]
  scheduleCount: number
}

const employmentLabels: Record<string, string> = { PNS: "PNS", PPPK: "PPPK", HONORER: "Honorer" }

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function TeacherDirectory({ teachers }: { teachers: DirectoryEntry[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return teachers.filter((teacher) => {
      const matchesQuery = !keyword
        || teacher.name.toLowerCase().includes(keyword)
        || teacher.nip?.includes(keyword)
        || teacher.email?.toLowerCase().includes(keyword)
        || teacher.position?.toLowerCase().includes(keyword)
        || teacher.subjects.some((subject) => subject.toLowerCase().includes(keyword))
      const matchesStatus = status === "all" || teacher.employmentStatus === status
      return matchesQuery && matchesStatus
    })
  }, [teachers, query, status])

  function exportCsv() {
    const header = ["Nama", "NIP", "Email", "Telepon", "Status Kepegawaian", "Jabatan", "TMT", "Wali Kelas", "Mata Pelajaran", "Jumlah Jadwal", "Status Akun"]
    const rows = filtered.map((teacher) => [
      teacher.name, teacher.nip ?? "", teacher.email ?? "", teacher.phone ?? "",
      teacher.employmentStatus ? employmentLabels[teacher.employmentStatus] : "",
      teacher.position ?? "", teacher.teachingSince ?? "", teacher.homeroom ?? "",
      teacher.subjects.join("; "), String(teacher.scheduleCount), teacher.active ? "Aktif" : "Nonaktif",
    ])
    const csv = [header, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\r\n")
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `direktori-guru-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_200px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, NIP, jabatan, atau mapel..." className="pl-9" />
          </div>
          <Select value={status} onValueChange={(value) => value && setStatus(value)}>
            <SelectTrigger aria-label="Filter status kepegawaian">
              <SelectValue>
                {(value: string) => (value === "all" ? "Semua status" : employmentLabels[value] ?? "Semua status")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="PNS">PNS</SelectItem>
              <SelectItem value="PPPK">PPPK</SelectItem>
              <SelectItem value="HONORER">Honorer</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv}><Download className="size-4" />Export CSV</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-12 text-center">No</TableHead>
                <TableHead className="min-w-48">Nama</TableHead><TableHead>NIP</TableHead><TableHead>Status</TableHead>
                <TableHead>Jabatan</TableHead><TableHead>Mata Pelajaran</TableHead><TableHead className="text-center">Jadwal</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Tidak ada guru yang cocok dengan pencarian.</TableCell></TableRow>
                ) : filtered.map((teacher, index) => (
                  <TableRow key={teacher.id} className={teacher.active ? undefined : "opacity-65"}>
                    <TableCell className="text-center text-muted-foreground tabular-nums">{tableRowNumber(index)}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/guru/${teacher.id}`} className="underline-offset-4 transition-colors hover:text-primary hover:underline">{teacher.name}</Link>
                      {teacher.homeroom ? <span className="ml-2 text-xs text-muted-foreground">Wali {teacher.homeroom}</span> : null}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{teacher.nip ?? "-"}</TableCell>
                    <TableCell>{teacher.employmentStatus ? <Badge variant="secondary">{employmentLabels[teacher.employmentStatus]}</Badge> : <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{teacher.position ?? "Guru"}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal text-muted-foreground">{teacher.subjects.length ? teacher.subjects.join(", ") : "-"}</TableCell>
                    <TableCell className="text-center tabular-nums">{teacher.scheduleCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="size-4" />Menampilkan {filtered.length} dari {teachers.length} guru.
      </p>
    </div>
  )
}

"use client"

import { useState } from "react"
import { BookOpenCheck, CalendarOff, Contact, School, UserRoundCog, Users } from "lucide-react"
import { CsvDelimiterField } from "@/components/csv-delimiter-field"
import { ExportButton } from "@/components/export/export-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { localDateValue } from "@/lib/date"

type Role = "ADMIN" | "GURU"
type Option = { name: string; grade: string }

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => next && onChange(String(next))}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function ExportCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Users
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="size-5 text-primary" />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-5">{children}</CardContent>
    </Card>
  )
}

export function ExportCenter({ role, classes }: { role: Role; classes: Option[] }) {
  const [delimiter, setDelimiter] = useState(",")
  const [studentClass, setStudentClass] = useState("all")
  const [studentStatus, setStudentStatus] = useState("all")
  const [teacherStatus, setTeacherStatus] = useState("all")
  const [assignment, setAssignment] = useState("all")
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [recapDate, setRecapDate] = useState(localDateValue())
  const [recapClass, setRecapClass] = useState("all")
  const [grade, setGrade] = useState("all")
  const classOptions = [{ value: "all", label: "Semua kelas" }, ...classes.map((item) => ({ value: item.name, label: item.name }))]
  const grades = Array.from(new Set(classes.map((item) => item.grade))).sort()

  return (
    <>
      <CsvDelimiterField value={delimiter} onChange={setDelimiter} description="Delimiter ini digunakan untuk seluruh file yang di-export dari halaman ini." />

      <div className="grid gap-4 lg:grid-cols-2">
        {role === "ADMIN" ? (
          <>
            <ExportCard icon={Users} title="Data Siswa" description="Daftar identitas, kelas, dan status siswa.">
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldSelect label="Kelas" value={studentClass} onChange={setStudentClass} options={classOptions} />
                <FieldSelect label="Status" value={studentStatus} onChange={setStudentStatus} options={[{ value: "all", label: "Semua status" }, { value: "active", label: "Aktif" }, { value: "inactive", label: "Nonaktif" }]} />
              </div>
              <ExportButton type="students" params={{ delimiter, class: studentClass, status: studentStatus }} />
            </ExportCard>

            <ExportCard icon={Contact} title="Data Guru" description="Daftar akun guru, kontak, dan penugasan wali kelas.">
              <FieldSelect label="Status" value={teacherStatus} onChange={setTeacherStatus} options={[{ value: "all", label: "Semua status" }, { value: "active", label: "Aktif" }, { value: "inactive", label: "Nonaktif" }]} />
              <ExportButton type="teachers" params={{ delimiter, status: teacherStatus }} />
            </ExportCard>

            <ExportCard icon={UserRoundCog} title="Data Wali Kelas" description="Daftar kelas beserta guru yang ditugaskan sebagai wali kelas.">
              <FieldSelect label="Penugasan" value={assignment} onChange={setAssignment} options={[{ value: "all", label: "Semua kelas" }, { value: "assigned", label: "Sudah ditentukan" }, { value: "unassigned", label: "Belum ditentukan" }]} />
              <ExportButton type="homerooms" params={{ delimiter, assignment }} />
            </ExportCard>

            <ExportCard icon={CalendarOff} title="Kalender Hari Libur" description="Daftar tanggal yang ditandai sebagai hari libur sekolah.">
              <div className="space-y-2"><Label htmlFor="export-year">Tahun</Label><Input id="export-year" type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(event.target.value)} /></div>
              <ExportButton type="holidays" params={{ delimiter, year }} />
            </ExportCard>
          </>
        ) : null}

        <ExportCard icon={BookOpenCheck} title="Rekap Siswa" description="Akumulasi status kehadiran siswa dan status pada tanggal yang dipilih.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="student-recap-date">Tanggal status</Label><Input id="student-recap-date" type="date" value={recapDate} onChange={(event) => setRecapDate(event.target.value)} /></div>
            <FieldSelect label="Kelas" value={recapClass} onChange={setRecapClass} options={classOptions} />
          </div>
          <ExportButton type="attendance_students" params={{ delimiter, date: recapDate, class: recapClass }} />
        </ExportCard>

        <ExportCard icon={School} title="Rekap Kelas" description="Ringkasan absensi dan status input setiap kelas pada satu tanggal.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="class-recap-date">Tanggal rekap</Label><Input id="class-recap-date" type="date" value={recapDate} onChange={(event) => setRecapDate(event.target.value)} /></div>
            <FieldSelect label="Tingkat" value={grade} onChange={setGrade} options={[{ value: "all", label: "Semua tingkat" }, ...grades.map((item) => ({ value: item, label: `Tingkat ${item}` }))]} />
          </div>
          <ExportButton type="attendance_classes" params={{ delimiter, date: recapDate, grade }} />
        </ExportCard>
      </div>
    </>
  )
}

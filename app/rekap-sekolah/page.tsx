import { GraduationCap, Users, UserCheck, UserX } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { StatusPill } from "@/components/dashboard/status-pill"
import { AbsenceRanking } from "@/components/dashboard/absence-ranking"
import {
  computeSummary,
  statusMeta,
  type AttendanceStatus,
} from "@/lib/dashboard-data"
import { getAbsenceRanking, getClassRecords, getHoliday } from "@/lib/server-dashboard"
import { UrlDateFilter } from "@/components/url-date-filter"
import { formatLongDate, localDateValue, parseDateValue } from "@/lib/date"
import { ExportButton } from "@/components/export/export-button"

const statusOrder: AttendanceStatus[] = ["hadir", "sakit", "izin", "dispensasi", "alfa"]

export default async function RekapSekolahPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const requestedDate = (await searchParams).date
  const date = localDateValue(parseDateValue(requestedDate))
  const holiday = await getHoliday(parseDateValue(date))
  if (holiday) return <PageContainer><PageHeading title="Rekap Sekolah" description={`Ringkasan kehadiran seluruh siswa pada ${formatLongDate(date)}.`} action={<><UrlDateFilter value={date} ariaLabel="Tanggal rekap sekolah" /><ExportButton type="attendance_classes" params={{ date }} /></>} /><Card className="border-primary/30 bg-primary/5"><CardContent className="py-12 text-center"><p className="text-lg font-semibold">Hari Libur</p><p className="text-sm text-muted-foreground">{holiday.name}. Tidak ada kewajiban input absensi pada tanggal ini.</p></CardContent></Card></PageContainer>
  const [classes, absenceRanking] = await Promise.all([
    getClassRecords(parseDateValue(date)),
    getAbsenceRanking(),
  ])
  const summary = computeSummary(classes)
  const perGrade = ["VII", "VIII", "IX"].map((grade) => { const records = classes.filter((c) => c.grade === grade); return { grade, records, summary: computeSummary(records) } })
  const totalTidakHadir =
    summary.totalSakit + summary.totalIzin + summary.totalDispensasi + summary.totalAlfa

  const stats = [
    {
      label: "Total Siswa",
      value: summary.totalStudentsAll.toLocaleString("id-ID"),
      icon: Users,
      tone: "bg-[var(--chart-2)]/12 text-[var(--chart-2)]",
    },
    {
      label: "Hadir",
      value: summary.totalHadir.toLocaleString("id-ID"),
      icon: UserCheck,
      tone: "bg-[var(--chart-1)]/12 text-[var(--chart-1)]",
    },
    {
      label: "Tidak Hadir",
      value: totalTidakHadir.toLocaleString("id-ID"),
      icon: UserX,
      tone: "bg-[var(--chart-5)]/12 text-[var(--chart-5)]",
    },
    {
      label: "Tingkat Kehadiran",
      value: `${summary.attendanceRate}%`,
      icon: GraduationCap,
      tone: "bg-primary/12 text-primary",
    },
  ]

  const totalStatuses: Record<AttendanceStatus, number> = {
    hadir: summary.totalHadir,
    sakit: summary.totalSakit,
    izin: summary.totalIzin,
    dispensasi: summary.totalDispensasi,
    alfa: summary.totalAlfa,
  }
  const totalCounted = statusOrder.reduce((s, k) => s + totalStatuses[k], 0)

  return (
    <PageContainer>
      <PageHeading
        title="Rekap Sekolah"
        description={`Ringkasan kehadiran seluruh siswa pada ${formatLongDate(date)}.`}
        action={<><UrlDateFilter value={date} ariaLabel="Tanggal rekap sekolah" /><ExportButton type="attendance_classes" params={{ date }} /></>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-border/70">
            <CardContent className="flex items-center gap-4 p-5">
              <span className={`flex size-11 items-center justify-center rounded-xl ${s.tone}`}>
                <s.icon className="size-5" />
              </span>
              <div className="space-y-0.5">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold tracking-tight text-foreground">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Distribusi Status Kehadiran</CardTitle>
          <CardDescription>Sebaran status seluruh siswa yang absensinya sudah diinput</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
            {statusOrder.map((k) => {
              const pct = totalCounted > 0 ? (totalStatuses[k] / totalCounted) * 100 : 0
              if (pct === 0) return null
              return (
                <div
                  key={k}
                  style={{ width: `${pct}%`, backgroundColor: statusMeta[k].token }}
                  aria-label={`${statusMeta[k].label} ${pct.toFixed(1)}%`}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {statusOrder.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: statusMeta[k].token }}
                />
                <span className="text-sm text-muted-foreground">{statusMeta[k].label}</span>
                <span className="text-sm font-semibold text-foreground">{totalStatuses[k]}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rekap per Tingkat</CardTitle>
          <CardDescription>Perbandingan kehadiran antar tingkat kelas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {perGrade.map(({ grade, records, summary: gs }) => {
            const tidakHadir = gs.totalSakit + gs.totalIzin + gs.totalDispensasi + gs.totalAlfa
            return (
              <div
                key={grade}
                className="flex flex-col gap-4 rounded-xl border border-border/70 bg-secondary/40 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-primary/12 text-lg font-bold text-primary">
                    {grade}
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">Tingkat {grade}</p>
                    <p className="text-sm text-muted-foreground">
                      {records.length} kelas &middot; {gs.totalStudentsAll} siswa
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status="hadir" count={gs.totalHadir} />
                  <StatusPill status="sakit" count={gs.totalSakit} />
                  <StatusPill status="izin" count={gs.totalIzin} />
                  <StatusPill status="dispensasi" count={gs.totalDispensasi} />
                  <StatusPill status="alfa" count={gs.totalAlfa} />
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-foreground">{gs.attendanceRate}%</p>
                  <p className="text-xs text-muted-foreground">{tidakHadir} tidak hadir</p>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <AbsenceRanking students={absenceRanking} />
    </PageContainer>
  )
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DonutChart } from "@/components/dashboard/donut-chart"
import { AttendanceBarChart } from "@/components/dashboard/attendance-bar-chart"
import type { ClassRecord } from "@/lib/dashboard-data"

type ChartsSummary = {
  submittedCount: number
  notSubmittedCount: number
  totalHadir: number
  totalSakit: number
  totalIzin: number
  totalAlfa: number
  totalDispensasi: number
  completionRate: number
  attendanceRate: number
}

export function InputCompletionCard({ summary }: { summary: ChartsSummary }) {
  const inputSegments = [
    { label: "Sudah input", value: summary.submittedCount, color: "var(--chart-1)" },
    { label: "Belum input", value: summary.notSubmittedCount, color: "var(--chart-5)" },
  ]

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Kelengkapan Input</CardTitle>
        <CardDescription>Status pengisian absensi per kelas</CardDescription>
      </CardHeader>
      <CardContent>
        <DonutChart
          segments={inputSegments}
          centerValue={`${summary.completionRate}%`}
          centerLabel="Lengkap"
        />
      </CardContent>
    </Card>
  )
}

export function AttendanceCard({ summary }: { summary: ChartsSummary }) {
  const attendanceSegments = [
    { label: "Hadir", value: summary.totalHadir, color: "var(--chart-1)" },
    { label: "Sakit", value: summary.totalSakit, color: "var(--chart-4)" },
    { label: "Izin", value: summary.totalIzin, color: "var(--chart-2)" },
    { label: "Dispensasi", value: summary.totalDispensasi, color: "var(--chart-6)" },
    { label: "Alfa", value: summary.totalAlfa, color: "var(--chart-5)" },
  ]

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Kehadiran Siswa</CardTitle>
        <CardDescription>Rincian status kehadiran pada tanggal dipilih</CardDescription>
      </CardHeader>
      <CardContent>
        <DonutChart
          segments={attendanceSegments}
          centerValue={`${summary.attendanceRate}%`}
          centerLabel="Hadir"
        />
      </CardContent>
    </Card>
  )
}

export function ClassRecapCard({ records }: { records: ClassRecord[] }) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Rekap Kehadiran per Kelas</CardTitle>
        <CardDescription>Perbandingan hadir & tidak hadir</CardDescription>
      </CardHeader>
      <CardContent>
        <AttendanceBarChart records={records} />
      </CardContent>
    </Card>
  )
}

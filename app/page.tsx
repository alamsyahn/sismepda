"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CalendarOff, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { SummaryCards } from "@/components/dashboard/summary-cards"
import {
  InputCompletionCard,
  AttendanceCard,
  ClassRecapCard,
} from "@/components/dashboard/charts-section"
import { WeeklyTrend } from "@/components/dashboard/weekly-trend"
import type { WeeklyTrendPoint } from "@/components/dashboard/weekly-trend"
import { ClassesNotInput } from "@/components/dashboard/classes-not-input"
import { AbsentStudentsTable } from "@/components/dashboard/absent-students-table"
import { ClassProgress } from "@/components/dashboard/class-progress"
import { RecentActivity } from "@/components/dashboard/recent-activity"
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton"
import { PageContainer } from "@/components/layout/page-container"
import { localDateValue } from "@/lib/date"
import {
  computeSummary,
  type ClassRecord,
  type AbsentStudent,
  type ActivityItem,
} from "@/lib/dashboard-data"

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [date, setDate] = useState(localDateValue())
  const [selectedClass, setSelectedClass] = useState("all")
  const [classes, setClasses] = useState<ClassRecord[]>([])
  const [absentStudents, setAbsentStudents] = useState<AbsentStudent[]>([])
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([])
  const [weeklyTrend, setWeeklyTrend] = useState<WeeklyTrendPoint[]>([])
  const [holiday, setHoliday] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => { setLoading(true); setError(false); fetch(`/api/dashboard?date=${date}`).then((response) => { if (!response.ok) throw new Error(); return response.json() }).then((data) => { setClasses(data.classes); setAbsentStudents(data.absentStudents); setRecentActivity(data.recentActivity); setWeeklyTrend(data.weeklyTrend); setHoliday(data.holiday); setLoading(false) }).catch(() => { setError(true); setLoading(false) }) }, [date])

  const records = useMemo(
    () => (selectedClass === "all" ? classes : classes.filter((c) => c.id === selectedClass)),
    [classes, selectedClass],
  )
  const summary = useMemo(() => computeSummary(records), [records])

  const filteredAbsent = useMemo(() => {
    if (selectedClass === "all") return absentStudents
    const name = classes.find((c) => c.id === selectedClass)?.name
    return absentStudents.filter((s) => s.className === name)
  }, [absentStudents, classes, selectedClass])

  return (
    <PageContainer>
      <DashboardHeader selectedClass={selectedClass} onClassChange={setSelectedClass} classes={classes} date={date} onDateChange={setDate} />

          {error ? (
            <ErrorState />
          ) : loading ? (
            <DashboardSkeleton />
          ) : holiday ? (
            <Card className="border-primary/30 bg-primary/5"><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CalendarOff className="size-7" /></span><div><h2 className="text-lg font-semibold">Hari Libur</h2><p className="text-sm text-muted-foreground">{holiday.name}. Tidak ada kewajiban input absensi pada tanggal ini.</p></div></CardContent></Card>
          ) : (
            <div className="space-y-6">
              <SummaryCards
                totalClasses={summary.totalClasses}
                submittedCount={summary.submittedCount}
                notSubmittedCount={summary.notSubmittedCount}
                attendanceRate={summary.attendanceRate}
                totalStudentsAll={summary.totalStudentsAll}
                onTimeCount={summary.onTimeCount}
                attendanceDelta={summary.attendanceDelta}
              />

              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
                <div className="flex flex-col gap-4 xl:col-span-2">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <InputCompletionCard summary={summary} />
                    <AttendanceCard summary={summary} />
                  </div>
                  <ClassProgress records={records} />
                </div>
                <div className="flex flex-col gap-4">
                  <ClassRecapCard records={records} />
                  <WeeklyTrend data={weeklyTrend} />
                </div>
              </div>

              <ClassesNotInput records={records} date={date} />

              <AbsentStudentsTable students={filteredAbsent} />

              <RecentActivity items={recentActivity} />
            </div>
          )}
    </PageContainer>
  )
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/12 text-destructive">
        <AlertCircle className="size-7" />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Gagal memuat data</h2>
        <p className="max-w-sm text-sm text-muted-foreground text-pretty">
          Terjadi kesalahan saat mengambil data absensi. Periksa koneksi Anda lalu coba lagi.
        </p>
      </div>
      <Button variant="outline" className="gap-2 bg-card">
        <RefreshCw className="size-4" />
        Muat Ulang
      </Button>
    </div>
  )
}

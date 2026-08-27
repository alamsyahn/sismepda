import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CalendarDays, CircleCheckBig, GraduationCap, History, IdCard, ShieldCheck, TrendingUp, TriangleAlert, UserRound } from "lucide-react"
import { requireUser } from "@/lib/auth-guards"
import { readStudentProfile } from "@/lib/server-student-profile"
import type { AttendanceStatus } from "@/lib/dashboard-data"
import { PageContainer } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { StatusPill } from "@/components/dashboard/status-pill"
import { StudentAttendanceTrend } from "@/components/siswa/student-attendance-trend"
import { StudentHistoryFilters } from "@/components/siswa/student-history-filters"
import { StudentViolationPoints } from "@/components/siswa/student-violation-points"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProfileNameLink } from "@/components/profile/profile-name-link"

export default async function StudentProfilePage({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser()
  const { studentId } = await params
  const query = await searchParams
  const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined
  const profile = await readStudentProfile(user, studentId, { from: one(query.from), to: one(query.to), status: one(query.status), page: one(query.page) })
  if (!profile) notFound()
  const { student, summary, history, pagination, filters, pointSummary, violationPoints } = profile
  const pageHref = (page: number) => { const q = new URLSearchParams(); if (filters.from) q.set("from", filters.from); if (filters.to) q.set("to", filters.to); if (filters.status !== "all") q.set("status", filters.status); q.set("page", String(page)); return `/siswa/${studentId}?${q}` }

  return <PageContainer>
    <div className="space-y-6">
      <div><Button render={<Link href="/rekap-siswa" />} nativeButton={false} variant="ghost" className="-ml-3 mb-2 text-muted-foreground"><ArrowLeft className="size-4" />Kembali ke Rekap Siswa</Button>
        <Card className="overflow-hidden border-border/70"><div className="h-1.5 bg-gradient-to-r from-primary via-[var(--chart-2)] to-[var(--chart-3)]" /><CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6"><span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><UserRound className="size-8" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{student.name}</h1><Badge variant={student.active ? "default" : "secondary"}>{student.active ? "Aktif" : "Nonaktif"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Profil dan riwayat kehadiran siswa</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"><span className="flex items-center gap-1.5"><IdCard className="size-4 text-muted-foreground" />NIS {student.nis ?? "-"}</span><span className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-muted-foreground" />NISN {student.nisn ?? "-"}</span><span className="flex items-center gap-1.5"><GraduationCap className="size-4 text-muted-foreground" />Kelas {student.schoolClass.name}</span>{student.schoolClass.homeroomUser?.name ? <span className="text-muted-foreground">Wali kelas: <ProfileNameLink type="teacher" id={student.schoolClass.homeroomUser.id} name={student.schoolClass.homeroomUser.name} /></span> : null}</div></div>{user.role === "ADMIN" ? <Button render={<Link href="/siswa" />} nativeButton={false} variant="outline">Kelola Data Siswa</Button> : null}</CardContent></Card>
      </div>

      <StudentViolationPoints studentId={studentId} summary={pointSummary} records={violationPoints} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Kehadiran" value={`${summary.attendanceRate}%`} detail={`${summary.counts.hadir} dari ${summary.total} hari tercatat`} icon={<TrendingUp />} tone="primary"><Progress value={summary.attendanceRate} className="mt-3 h-2" /></Metric><Metric title="Hadir Berturut-turut" value={`${summary.currentPresentStreak} hari`} detail="Berdasarkan record terakhir" icon={<CircleCheckBig />} tone="success" /><Metric title="Tidak Hadir Bulan Berjalan" value={String(summary.currentMonthAbsences)} detail="Dalam bulan berjalan pada periode terpilih" icon={<CalendarDays />} tone="warning" /><Metric title="Alfa Terakhir" value={summary.lastAlfaDate ? formatDate(summary.lastAlfaDate, false) : "Tidak ada"} detail={`${summary.counts.alfa} alfa dalam seluruh riwayat`} icon={<TriangleAlert />} tone="danger" /></div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]"><StudentAttendanceTrend data={summary.monthlyTrend} /><Card className="border-border/70"><CardHeader><CardTitle>Komposisi Kehadiran</CardTitle><CardDescription>Total status dalam periode yang dipilih.</CardDescription></CardHeader><CardContent className="space-y-3">{(["hadir","sakit","izin","dispensasi","alfa"] as AttendanceStatus[]).map(status => <div key={status} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2.5"><StatusPill status={status} /><span className="font-semibold tabular-nums">{summary.counts[status]}</span></div>)}</CardContent></Card></div> 
      

      <Card className="border-border/70"><CardHeader><div className="flex items-start gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><History className="size-5" /></span><div><CardTitle>Riwayat Absensi</CardTitle><CardDescription>Filter berdasarkan periode dan status. Data terbaru ditampilkan lebih dulu.</CardDescription></div></div></CardHeader><CardContent className="space-y-5"><StudentHistoryFilters studentId={studentId} {...filters} /><div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Status</TableHead><TableHead>Catatan</TableHead><TableHead>Dicatat oleh</TableHead><TableHead>Diperbarui</TableHead></TableRow></TableHeader><TableBody>{history.length === 0 ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Belum ada riwayat yang sesuai dengan filter.</TableCell></TableRow> : history.map(record => <TableRow key={record.id}><TableCell><p className="font-medium">{formatDate(record.attendanceDay.date)}</p></TableCell><TableCell><StatusPill status={record.status.toLowerCase() as AttendanceStatus} /></TableCell><TableCell className="max-w-64 whitespace-normal text-muted-foreground">{record.note || "—"}</TableCell><TableCell><ProfileNameLink type="teacher" id={record.attendanceDay.submittedBy.id} name={record.attendanceDay.submittedBy.name} /></TableCell><TableCell className="text-muted-foreground">{formatDateTime(record.attendanceDay.updatedAt)}</TableCell></TableRow>)}</TableBody></Table></div><div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>Menampilkan {history.length} dari {pagination.total} riwayat</p><div className="flex gap-2"><Button render={<Link href={pageHref(pagination.page - 1)} />} nativeButton={false} variant="outline" size="sm" disabled={pagination.page <= 1}>Sebelumnya</Button><span className="flex items-center px-2">Halaman {pagination.page} dari {pagination.totalPages}</span><Button render={<Link href={pageHref(pagination.page + 1)} />} nativeButton={false} variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages}>Berikutnya</Button></div></div></CardContent></Card>
    </div>
  </PageContainer>
}

function Metric({ title, value, detail, icon, tone, children }: { title: string; value: string; detail: string; icon: React.ReactNode; tone: "primary"|"success"|"warning"|"danger"; children?: React.ReactNode }) { const colors={primary:"bg-primary/10 text-primary",success:"bg-[var(--chart-1)]/12 text-[var(--chart-1)]",warning:"bg-[var(--chart-4)]/15 text-[var(--chart-4)]",danger:"bg-[var(--chart-5)]/12 text-[var(--chart-5)]"}; return <Card className="border-border/70"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p></div><span className={`flex size-10 items-center justify-center rounded-xl [&_svg]:size-5 ${colors[tone]}`}>{icon}</span></div><p className="mt-2 text-xs text-muted-foreground">{detail}</p>{children}</CardContent></Card> }
function formatDate(date: Date, weekday=true) { return new Intl.DateTimeFormat("id-ID", { ...(weekday?{weekday:"long" as const}:{}), day:"numeric", month:"short", year:"numeric", timeZone:"Asia/Jakarta" }).format(date) }
function formatDateTime(date: Date) { return new Intl.DateTimeFormat("id-ID", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"Asia/Jakarta" }).format(date) }

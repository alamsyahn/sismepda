import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, BookOpen, CalendarClock, GraduationCap, IdCard, Layers, Mail, Phone, ShieldCheck, UserRound } from "lucide-react"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { readSubjectsAndClasses, readTeacherProfile } from "@/lib/server-teacher-profile"
import { canManageTeacherProfile } from "@/lib/teacher-profile"
import { PageContainer } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TeacherEmploymentEditor } from "@/components/guru/teacher-employment-editor"
import { TeacherScheduleManager } from "@/components/guru/teacher-schedule-manager"

const employmentLabels: Record<string, string> = { PNS: "PNS", PPPK: "PPPK", HONORER: "Honorer" }

export default async function TeacherProfilePage({ params }: { params: Promise<{ teacherId: string }> }) {
  const sessionUser = await requireUser()
  const { teacherId } = await params
  const [profile, viewer] = await Promise.all([
    readTeacherProfile(teacherId),
    prisma.user.findUnique({ where: { id: sessionUser.id }, select: { role: true, canManageTeacherProfiles: true } }),
  ])
  if (!profile || !viewer) notFound()

  const { teacher, schedule, load, classSubjects } = profile
  const canManage = canManageTeacherProfile(viewer)
  const contactPhone = teacher.phone?.replace(/[^\d]/g, "")

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <Button render={<Link href="/guru/direktori" />} nativeButton={false} variant="ghost" className="-ml-3 mb-2 text-muted-foreground">
            <ArrowLeft className="size-4" />Kembali ke Direktori Guru
          </Button>
          <Card className="overflow-hidden border-border/70">
            <div className="h-1.5 bg-gradient-to-r from-primary via-[var(--chart-2)] to-[var(--chart-3)]" />
            <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
              <span className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 text-primary">
                {teacher.photoUrl
                  ? <Image src={teacher.photoUrl} alt={`Foto ${teacher.name}`} width={80} height={80} unoptimized className="size-full object-cover" />
                  : <UserRound className="size-9" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{teacher.name}</h1>
                  <Badge variant={teacher.active ? "default" : "secondary"}>{teacher.active ? "Aktif" : "Nonaktif"}</Badge>
                  {teacher.employmentStatus ? <Badge variant="secondary">{employmentLabels[teacher.employmentStatus]}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{teacher.position ?? (teacher.role === "ADMIN" ? "Administrator" : "Guru")}</p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  <span className="flex items-center gap-1.5"><IdCard className="size-4 text-muted-foreground" />NIP {teacher.nip ?? "-"}</span>
                  <span className="flex items-center gap-1.5"><Mail className="size-4 text-muted-foreground" />{teacher.email ?? "-"}</span>
                  <span className="flex items-center gap-1.5"><Phone className="size-4 text-muted-foreground" />{teacher.phone ?? "-"}</span>
                  {teacher.homeroomClass?.name ? <span className="flex items-center gap-1.5"><GraduationCap className="size-4 text-muted-foreground" />Wali kelas {teacher.homeroomClass.name}</span> : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {teacher.email ? <Button render={<a href={`mailto:${teacher.email}`} />} nativeButton={false} variant="outline" size="sm"><Mail className="size-4" />Email</Button> : null}
                  {contactPhone ? <Button render={<a href={`https://wa.me/${contactPhone.startsWith("0") ? `62${contactPhone.slice(1)}` : contactPhone}`} target="_blank" rel="noopener noreferrer" />} nativeButton={false} variant="outline" size="sm"><Phone className="size-4" />WhatsApp</Button> : null}
                </div>
              </div>
              {canManage ? (
                <TeacherEmploymentEditor
                  teacherId={teacher.id}
                  initial={{
                    employmentStatus: teacher.employmentStatus,
                    position: teacher.position,
                    teachingSince: teacher.teachingSince ? teacher.teachingSince.toISOString().slice(0, 10) : "",
                    belajarId: teacher.belajarId,
                    subjects: teacher.subjects.map((item) => item.name),
                  }}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric title="Jam Mengajar / Minggu" value={String(load.totalPeriods)} detail={`Tersebar pada ${load.dayCount} hari`} icon={<CalendarClock />} />
          <Metric title="Kelas Diampu" value={String(load.classCount)} detail="Jumlah kelas dalam jadwal" icon={<Layers />} />
          <Metric title="Mata Pelajaran" value={String(load.subjectCount || teacher.subjects.length)} detail="Berdasarkan jadwal dan data guru" icon={<BookOpen />} />
          <Metric title="TMT Mengajar" value={teacher.teachingSince ? formatDate(teacher.teachingSince) : "-"} detail="Terhitung mulai tanggal" icon={<ShieldCheck />} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card className="border-border/70">
            <CardHeader><CardTitle>Data Kepegawaian</CardTitle><CardDescription>Informasi administratif guru.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Status kepegawaian" value={teacher.employmentStatus ? employmentLabels[teacher.employmentStatus] : "Belum ditentukan"} />
              <Row label="Jabatan" value={teacher.position ?? "Guru"} />
              <Row label="Akun belajar.id" value={teacher.belajarId ?? "Belum tertaut"} />
              <Row label="Mata pelajaran" value={teacher.subjects.length ? teacher.subjects.map((item) => item.name).join(", ") : "Belum diisi"} />
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader><CardTitle>Kelas & Mata Pelajaran</CardTitle><CardDescription>Kelas yang diampu beserta pelajarannya.</CardDescription></CardHeader>
            <CardContent className="space-y-2.5">
              {classSubjects.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada kelas yang diampu.</p>
              ) : classSubjects.map((item) => (
                <div key={item.className} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                  <span className="flex items-center gap-2 font-medium"><UserRound className="size-4 text-muted-foreground" />{item.className}</span>
                  <span className="text-sm text-muted-foreground">{item.subjects.join(", ")}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <TeacherScheduleManager
          teacherId={teacher.id}
          schedule={schedule}
          duties={teacher.additionalDuties}
          canManage={canManage}
          {...(await readSubjectsAndClasses())}
        />
      </div>
    </PageContainer>
  )
}

function Metric({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <Card className="border-border/70">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p></div>
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 px-3 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(date)
}

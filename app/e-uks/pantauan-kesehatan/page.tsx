import { pageCan, requirePagePermission } from "@/lib/page-guards"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { safeClassReturnPath } from "@/lib/euks-class-navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EuksStudentSelector } from "@/components/e-uks/euks-student-selector"
import { EuksMeasurementTable } from "@/components/e-uks/euks-measurement-table"
import { EuksSickAbsenceTable } from "@/components/e-uks/euks-sick-absence-table"
import { EuksBmiChart } from "@/components/e-uks/euks-bmi-chart"
import { EuksKmsChart } from "@/components/e-uks/euks-kms-chart"
import {
  ageInYears,
  formatBmi,
  formatZScore,
  latestMeasurement,
  nutritionStatusLabel,
  nutritionStatus,
  toBmiSeries,
  toHeightSeries,
} from "@/lib/euks"
import { nutritionCategoryTone } from "@/lib/bmi-for-age"
import { cn } from "@/lib/utils"
import { readEuksClassOptions, readEuksStudentOptions, readStudentMonitoring } from "@/lib/server-euks"
import { fromPrismaDate } from "@/lib/school-date"

export const dynamic = "force-dynamic"

type Props = {
  searchParams: Promise<{ classId?: string; studentId?: string; returnTo?: string }>
}

export default async function PantauanKesehatanPage({ searchParams }: Props) {
  await requirePagePermission("euks.monitoring.read")
  const [canMeasurements, canCreateMeasurement, canDeleteMeasurement, canSickAbsences, canUpdateSickAbsence, canVisits] = await Promise.all([
    pageCan("euks.measurements.read"),
    pageCan("euks.measurements.create"),
    pageCan("euks.measurements.delete"),
    pageCan("euks.sick_absences.read"),
    pageCan("euks.sick_absences.update"),
    pageCan("euks.visits.read"),
  ])

  const { classId = "", studentId = "", returnTo = "" } = await searchParams
  const [classes, students] = await Promise.all([readEuksClassOptions(), readEuksStudentOptions()])
  const monitoring = studentId ? await readStudentMonitoring(studentId, {
    measurements: canMeasurements,
    sickAbsences: canSickAbsences,
    visits: canVisits,
  }) : null

  const series = monitoring ? toBmiSeries(monitoring.measurements) : []
  const heightSeries = monitoring
    ? toHeightSeries(monitoring.measurements, monitoring.student.birthDate)
    : []
  const latest = monitoring ? latestMeasurement(monitoring.measurements) : null
  const latestBmi = series.length > 0 ? series[series.length - 1].bmi : null
  const status = monitoring
    ? nutritionStatus({
        bmi: latestBmi,
        measuredAt: latest?.measuredAt ?? null,
        birthDate: monitoring.student.birthDate,
        gender: monitoring.student.gender,
      })
    : null
  const age =
    monitoring && monitoring.student.birthDate && latest
      ? ageInYears(monitoring.student.birthDate, latest.measuredAt)
      : null

  // Jalan pulang hanya diterima bila berupa path internal, sehingga `returnTo`
  // tidak dapat dipakai mengarahkan pengguna ke situs luar. Labelnya memakai
  // nama kelas bila kelasnya dikenal, supaya tombolnya berbunyi "Kembali ke
  // VII A" alih-alih generik.
  const safeBack = safeClassReturnPath(returnTo)
  const backTarget = safeBack
    ? {
        href: safeBack,
        label: classes.find((option) => option.id === classId)?.name ?? "Pantauan Kesehatan Kelas",
      }
    : null

  return (
    <PageContainer>
      {backTarget ? (
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="w-fit"
          render={<Link href={backTarget.href} />}
        >
          ← Kembali ke {backTarget.label}
        </Button>
      ) : null}

      <PageHeading
        title="Pantauan Kesehatan Siswa"
        description="Status gizi, riwayat sakit, dan tren IMT per siswa."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <EuksStudentSelector
          classes={classes}
          students={students}
          selectedClassId={classId}
          selectedStudentId={studentId}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Status Gizi (berdasarkan IMT)"
            value={status ? nutritionStatusLabel(status) : "-"}
            tone={status?.kind === "known" ? nutritionCategoryTone[status.category] : undefined}
            hint={
              status?.kind === "known"
                ? `IMT/U ${formatZScore(status.z)}${age !== null ? ` · umur ${age} tahun` : ""}`
                : undefined
            }
          />
          <SummaryCard title="Tinggi Badan Saat ini" value={latest ? `${latest.heightCm} cm` : "-"} />
          <SummaryCard title="Berat Badan Saat ini" value={latest ? `${latest.weightKg} kg` : "-"} />
          <SummaryCard title="IMT" value={formatBmi(latestBmi)} />
        </div>
      </div>

      {!monitoring ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Pilih kelas dan nama siswa untuk melihat pantauan kesehatan.
          </CardContent>
        </Card>
      ) : (
        <>
          {canSickAbsences ? <Card>
            <CardHeader>
              <CardTitle>Riwayat Ketidakhadiran Karena Sakit</CardTitle>
              <p className="text-muted-foreground text-sm">
                Data diambil otomatis dari rekap absensi Sismepda. Kolom Berturut-turut
                menghitung hari sakit beruntun dengan mengabaikan tanggal yang terdaftar
                sebagai hari libur. Catatan dan tindak lanjut dapat diubah langsung di tabel.
              </p>
            </CardHeader>
            <CardContent>
              <EuksSickAbsenceTable
                rows={monitoring.sickAbsences}
                canEdit={canUpdateSickAbsence}
                studentName={monitoring.student.name}
              />
            </CardContent>
          </Card> : null}

          {canVisits ? <Card>
            <CardHeader>
              <CardTitle>Riwayat Siswa Masuk UKS</CardTitle>
              <p className="text-muted-foreground text-sm">
                Data diambil otomatis dari menu Riwayat Kunjungan UKS.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">No</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Keluhan</TableHead>
                    <TableHead>Tindakan yang diberikan</TableHead>
                    <TableHead>Tindak lanjut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monitoring.visits.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                        Belum ada kunjungan UKS untuk siswa ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    monitoring.visits.map((visit, index) => (
                      <TableRow key={visit.id}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>{fromPrismaDate(visit.occurredAt)}</TableCell>
                        <TableCell>{visit.complaint}</TableCell>
                        <TableCell>{visit.treatment}</TableCell>
                        <TableCell>{visit.followUp ?? "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card> : null}

          {canMeasurements ? <Card>
            <CardHeader>
              <CardTitle>Grafik IMT</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <EuksBmiChart points={series} />
              <EuksMeasurementTable
                studentId={monitoring.student.id}
                points={series}
                canCreate={canCreateMeasurement}
                canDelete={canDeleteMeasurement}
              />
            </CardContent>
          </Card> : null}

          {canMeasurements ? <Card>
            <CardHeader>
              <CardTitle>Kartu Menuju Sehat (KMS)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <EuksKmsChart points={heightSeries} gender={monitoring.student.gender} />
              <p className="text-muted-foreground text-xs">
                Tinggi badan menurut umur terhadap kurva rujukan WHO 5-19 tahun. Pita hijau
                menandai rentang -2 s.d. +2 SD, kuning -3 s.d. -2 SD dan +2 s.d. +3 SD. Grafik ini
                menyajikan data, bukan diagnosis; penilaian pertumbuhan adalah kewenangan tenaga
                kesehatan.
              </p>
            </CardContent>
          </Card> : null}
        </>
      )}
    </PageContainer>
  )
}

function SummaryCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string
  value: string
  hint?: string
  tone?: "danger" | "warning" | "ok"
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p
          className={cn(
            "text-2xl font-semibold",
            tone === "danger" && "text-destructive",
            tone === "warning" && "text-amber-600 dark:text-amber-500",
          )}
        >
          {value}
        </p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

import { redirect } from "next/navigation"
import Link from "next/link"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EuksStudentSelector } from "@/components/e-uks/euks-student-selector"
import { EuksMeasurementTable } from "@/components/e-uks/euks-measurement-table"
import { EuksBmiChart } from "@/components/e-uks/euks-bmi-chart"
import { EuksAccessError, requireEuksViewer } from "@/lib/euks-access"
import { formatBmi, latestMeasurement, nutritionStatusLabel, nutritionStatus, toBmiSeries } from "@/lib/euks"
import { readEuksClassOptions, readEuksStudentOptions, readStudentMonitoring } from "@/lib/server-euks"
import { fromPrismaDate } from "@/lib/school-date"

export const dynamic = "force-dynamic"

type Props = {
  searchParams: Promise<{ classId?: string; studentId?: string }>
}

export default async function PantauanKesehatanPage({ searchParams }: Props) {
  let viewer
  try {
    viewer = await requireEuksViewer()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/")
    throw error
  }
  const capabilities = viewer.capabilities

  const { classId = "", studentId = "" } = await searchParams
  const [classes, students] = await Promise.all([readEuksClassOptions(), readEuksStudentOptions()])
  const monitoring = studentId ? await readStudentMonitoring(studentId) : null

  const series = monitoring ? toBmiSeries(monitoring.measurements) : []
  const latest = monitoring ? latestMeasurement(monitoring.measurements) : null
  const latestBmi = series.length > 0 ? series[series.length - 1].bmi : null

  return (
    <PageContainer>
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
          <SummaryCard title="Status Gizi (berdasarkan IMT)" value={nutritionStatusLabel(nutritionStatus())} />
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
          <Card>
            <CardHeader>
              <CardTitle>Riwayat Ketidakhadiran Karena Sakit</CardTitle>
              <p className="text-muted-foreground text-sm">
                Data diambil otomatis dari rekap absensi Sismepda.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">No</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead>Tindak Lanjut Sekolah</TableHead>
                    <TableHead className="text-right">Edit di Sismepda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monitoring.sickAbsences.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                        Tidak ada ketidakhadiran karena sakit.
                      </TableCell>
                    </TableRow>
                  ) : (
                    monitoring.sickAbsences.map((absence, index) => (
                      <TableRow key={absence.id}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>{fromPrismaDate(absence.date)}</TableCell>
                        <TableCell>{absence.note ?? "-"}</TableCell>
                        {/* Attendance has a single note field; there is no
                            separate school follow-up column to read from. */}
                        <TableCell className="text-muted-foreground">-</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false}
                            render={<Link href="/absensi/input" />}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
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
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Grafik IMT</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <EuksBmiChart points={series} />
              <EuksMeasurementTable
                studentId={monitoring.student.id}
                points={series}
                canEdit={capabilities.canEdit}
              />
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  )
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

"use client"

import { useMemo, useState } from "react"
import { ClipboardList } from "lucide-react"
import { PageHeading } from "@/components/layout/page-container"
import { WhatsAppReportCard } from "@/components/reports/whatsapp-report-card"
import { UrlDateFilter } from "@/components/url-date-filter"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  buildClassesNotSubmittedReport,
  buildStudentAttendanceReport,
  type WhatsAppReportClass,
} from "@/lib/whatsapp-report"

export function WhatsAppReportView({
  date,
  dateLabel,
  classes,
}: {
  date: string
  dateLabel: string
  classes: WhatsAppReportClass[]
}) {
  const [includeUnfilled, setIncludeUnfilled] = useState(true)
  const studentReport = useMemo(
    () => buildStudentAttendanceReport(dateLabel, classes, includeUnfilled),
    [classes, dateLabel, includeUnfilled],
  )
  const classesNotSubmittedReport = useMemo(
    () => buildClassesNotSubmittedReport(dateLabel, classes),
    [classes, dateLabel],
  )

  return (
    <>
      <PageHeading
        title="Laporan WhatsApp"
        description={`Siapkan laporan absensi untuk ${dateLabel} dalam format yang siap dikirim.`}
        action={
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
            <UrlDateFilter value={date} ariaLabel="Tanggal laporan WhatsApp" />
            <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-sm">
              <Switch
                id="include-unfilled-students"
                checked={includeUnfilled}
                onCheckedChange={setIncludeUnfilled}
                aria-describedby="include-unfilled-help"
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="include-unfilled-students" className="cursor-pointer leading-5">
                  Sertakan siswa yang belum diisi
                </Label>
                <p id="include-unfilled-help" className="max-w-sm text-xs leading-5 text-muted-foreground">
                  Siswa yang status absensinya belum diisi akan ditampilkan dengan keterangan (?)
                </p>
              </div>
            </div>
          </div>
        }
      />

      {classes.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ClipboardList className="size-7" />
            </span>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Belum ada data kelas aktif</p>
              <p className="text-sm text-muted-foreground">
                Laporan belum dapat dibuat sampai data kelas tersedia.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-6 xl:grid-cols-2 xl:items-start">
          <WhatsAppReportCard
            title="Rekap Absensi Siswa"
            description="Daftar siswa tidak hadir pada setiap kelas. Siswa yang belum diisi dapat disertakan melalui pilihan di atas."
            text={studentReport}
          />
          <WhatsAppReportCard
            title="Kelas Belum Input"
            description="Daftar kelas yang belum input atau masih memiliki siswa tanpa status absensi."
            text={classesNotSubmittedReport}
          />
        </div>
      )}
    </>
  )
}

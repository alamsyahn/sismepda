import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { EuksClassMonitoringDashboard } from "@/components/e-uks/euks-class-monitoring-dashboard"
import { EuksClassPrintAction } from "@/components/e-uks/euks-class-print"
import { requirePagePermission } from "@/lib/page-guards"
import { prisma } from "@/lib/prisma"
import { readClassMonitoring, readEuksClassOptions } from "@/lib/server-euks"
import { readSchoolName } from "@/lib/server-whatsapp"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { summarizeClassMonitoring } from "@/lib/euks-class-monitoring"
import { readClassMonitoringView } from "@/lib/euks-class-navigation"
import {
  bucketGranularity,
  defaultRange,
  semesterStartValue,
} from "@/lib/attendance-trend"
import { parseSchoolDate, todayInSchoolTimeZone } from "@/lib/school-date"

export const dynamic = "force-dynamic"

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Pantauan Kesehatan Kelas — tingkat agregasi antara Halaman Utama E-UKS dan
 * Pantauan Kesehatan Siswa.
 *
 * Izin yang dipakai `euks.monitoring.read`, sama persis dengan Pantauan
 * Kesehatan Siswa: halaman ini menampilkan data pantauan yang sama, hanya
 * dijumlahkan per kelas, sehingga tidak ada izin baru yang dibuat.
 *
 * Rentang periode berasal dari `defaultRange()` milik modul tren absensi yang
 * sudah ada — tidak ada definisi semester atau tahun ajaran baru di sini.
 * Ketika tahun ajaran pada Pengaturan belum valid, pilihan "sejak awal
 * semester" disembunyikan alih-alih memakai tanggal tebakan.
 */
export default async function PantauanKesehatanKelasPage({ searchParams }: Props) {
  await requirePagePermission("euks.monitoring.read")

  const params = await searchParams
  const view = readClassMonitoringView({
    get: (name) => {
      const value = params[name]
      return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
    },
  })

  const [classes, timeZone, setting, schoolName] = await Promise.all([
    readEuksClassOptions(),
    readSchoolTimeZone(),
    prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { academicYear: true, semester: true },
    }),
    readSchoolName(),
  ])

  const semesterStart = setting ? semesterStartValue(setting) : null
  const semesterAvailable = semesterStart !== null
  // Periode "semester" tanpa awal semester yang valid akan menghasilkan rentang
  // tebakan, jadi turunkan ke default alih-alih menampilkan angka yang tidak
  // dapat dipertanggungjawabkan.
  const granularity =
    view.granularity === "semester" && !semesterAvailable ? "bulanan" : view.granularity

  const today = todayInSchoolTimeZone(undefined, timeZone)
  const fallback = defaultRange(granularity, today, semesterStart)
  // `defaultRange()` bekerja dengan string biasa; parse ulang agar rentangnya
  // kembali menjadi SchoolDate bermerek sebelum dipakai query dan agregasi.
  const fallbackFrom = parseSchoolDate(fallback.from)
  const fallbackTo = parseSchoolDate(fallback.to)
  if (!fallbackFrom || !fallbackTo) {
    throw new Error("Rentang periode default tidak valid")
  }
  const from = (view.from ? parseSchoolDate(view.from) : null) ?? fallbackFrom
  const to = (view.to ? parseSchoolDate(view.to) : null) ?? fallbackTo

  // classId yang tidak dikenal diperlakukan seperti belum memilih kelas:
  // halaman tetap tampil dengan empty state, bukan galat.
  const raw = view.classId ? await readClassMonitoring(view.classId, { from, to }) : null
  const summary = raw
    ? summarizeClassMonitoring({
        ...raw,
        from,
        to,
        granularity: bucketGranularity(granularity),
        today,
      })
    : null

  return (
    <PageContainer>
      <PageHeading
        title="Pantauan Kesehatan Kelas"
        description="Ringkasan status gizi, ketidakhadiran karena sakit, kunjungan UKS, dan data kesehatan siswa per kelas."
        action={
          <EuksClassPrintAction
            summary={summary}
            meta={{ schoolName, granularity, from, to }}
          />
        }
      />

      {view.classId && !summary ? (
        <p className="text-muted-foreground text-sm">
          Kelas yang diminta tidak ditemukan. Pilih kelas lain dari daftar di bawah.
        </p>
      ) : null}

      <EuksClassMonitoringDashboard
        classes={classes}
        summary={summary}
        semesterAvailable={semesterAvailable}
      />
    </PageContainer>
  )
}

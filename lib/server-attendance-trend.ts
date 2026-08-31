import { getClassAccess } from "@/lib/class-access"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { databaseSchema } from "@/lib/database-config"
import {
  bucketGranularity,
  bucketKeys,
  buildBuckets,
  defaultRange,
  isTrendGranularity,
  jakartaDate,
  jakartaDateValue,
  jakartaEndOfDay,
  semesterStartValue,
  type TrendGranularity,
  type TrendResponse,
  type ValidAttendanceStatus,
} from "@/lib/attendance-trend"
import type { requireUser } from "@/lib/auth-guards"

type User = Awaited<ReturnType<typeof requireUser>>

/** Batas rentang: menahan permintaan yang tidak masuk akal, bukan membatasi semester. */
const MAX_RANGE_DAYS = 800

/** Ekspresi date_trunc Postgres per granularity, dievaluasi di waktu Jakarta. */
const truncUnit = { harian: "day", mingguan: "week", bulanan: "month" } as const

function qualifiedTable(table: string) {
  const connectionString = process.env.DATABASE_URL ?? ""
  const schema = databaseSchema(connectionString)
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`
  return Prisma.raw(`${quote(schema)}.${quote(table)}`)
}

export async function readAttendanceTrend(
  user: User,
  params: { granularity?: string | null; from?: string | null; to?: string | null; classId?: string | null },
): Promise<
  | { ok: true; data: TrendResponse }
  | { ok: false; status: number; error: string }
> {
  const granularity: TrendGranularity = isTrendGranularity(params.granularity) ? params.granularity : "harian"

  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { academicYear: true, semester: true },
  })
  const semesterStart = setting ? semesterStartValue(setting) : null

  if (granularity === "semester" && !semesterStart) {
    return {
      ok: false,
      status: 409,
      error: "Tahun ajaran pada Pengaturan belum valid, sehingga awal semester tidak dapat ditentukan",
    }
  }

  const today = jakartaDateValue(new Date())
  const fallback = defaultRange(granularity, today, semesterStart)
  // Rentang kustom hanya berlaku untuk granularity selain semester; "Sejak Awal
  // Semester" memang didefinisikan oleh periode akademik aktif.
  const from = granularity === "semester" ? fallback.from : (params.from?.trim() || fallback.from)
  const to = granularity === "semester" ? fallback.to : (params.to?.trim() || fallback.to)

  const fromDate = jakartaDate(from)
  const toDate = jakartaEndOfDay(to)
  if (!fromDate || !toDate) return { ok: false, status: 400, error: "Tanggal tidak valid" }
  if (fromDate > toDate) return { ok: false, status: 400, error: "Tanggal mulai tidak boleh setelah tanggal akhir" }
  if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    return { ok: false, status: 400, error: "Rentang tanggal terlalu panjang" }
  }

  const access = await getClassAccess(user)

  // Kelas yang boleh dilihat pemakai ini. Filter kelas opsional harus berada di
  // dalam cakupan tersebut agar tidak membocorkan data kelas lain.
  const allowedClasses = await prisma.schoolClass.findMany({
    where: access.where,
    select: { id: true },
  })
  const allowedIds = allowedClasses.map((item) => item.id)
  const classId = params.classId?.trim() || null
  if (classId && !allowedIds.includes(classId)) {
    return { ok: false, status: 404, error: "Kelas tidak ditemukan atau tidak dapat diakses" }
  }
  const classIds = classId ? [classId] : allowedIds

  if (classIds.length === 0) {
    return {
      ok: true,
      data: {
        granularity,
        from,
        to,
        semester: semesterInfo(setting, semesterStart, granularity),
        buckets: bucketKeys(granularity, from, to).map((key) => emptyBucket(granularity, key)),
      },
    }
  }

  // Satu query agregat untuk SELURUH status sekaligus: tidak ada N+1 dan tidak
  // ada dataset mentah yang dikirim ke browser. Pengelompokan memakai
  // date_trunc pada tanggal yang sudah dikonversi ke waktu Jakarta, sehingga
  // batas hari/minggu/bulan mengikuti kalender lokal, bukan UTC.
  const unit = truncUnit[bucketGranularity(granularity)]
  const attendanceTable = qualifiedTable("Attendance")
  const attendanceDayTable = qualifiedTable("AttendanceDay")
  const rows = await prisma.$queryRaw<Array<{ bucket: Date; status: ValidAttendanceStatus; total: bigint }>>`
    SELECT
      date_trunc(${unit}, d."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta') AS bucket,
      a."status"::text AS status,
      COUNT(*) AS total
    FROM ${attendanceTable} a
    JOIN ${attendanceDayTable} d ON d."id" = a."attendanceDayId"
    WHERE d."date" >= ${fromDate}
      AND d."date" <= ${toDate}
      AND d."classId" = ANY(${classIds})
    GROUP BY 1, 2
    ORDER BY 1
  `

  const buckets = buildBuckets({
    granularity,
    bucketKeys: bucketKeys(granularity, from, to),
    // `bucket` kembali sebagai timestamp tanpa zona yang sudah bernilai waktu
    // Jakarta, jadi komponen tanggalnya dibaca langsung dalam UTC.
    rows: rows.map((row) => ({
      bucket: row.bucket.toISOString().slice(0, 10),
      status: row.status,
      total: Number(row.total),
    })),
  })

  return {
    ok: true,
    data: { granularity, from, to, semester: semesterInfo(setting, semesterStart, granularity), buckets },
  }
}

function semesterInfo(
  setting: { academicYear: string; semester: string } | null,
  start: string | null,
  granularity: TrendGranularity,
) {
  if (granularity !== "semester" || !setting || !start) return null
  return { label: setting.semester, academicYear: setting.academicYear, start }
}

function emptyBucket(granularity: TrendGranularity, key: string) {
  return buildBuckets({ granularity, bucketKeys: [key], rows: [] })[0]
}

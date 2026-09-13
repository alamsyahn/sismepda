import { Prisma } from "@/app/generated/prisma/client"
import { databaseSchema } from "@/lib/database-config"
import { prisma } from "@/lib/prisma"
import type { EuksStudentOption, HealthMeasurement } from "@/lib/euks"
import {
  bucketByClass,
  classifyStudentNutrition,
  type ClassNutritionBucket,
} from "@/lib/euks-nutrition"
import type { TrendVisit } from "@/lib/euks-trends"
import {
  compareSchoolDates,
  fromPrismaDate,
  prismaSchoolDateRange,
  type SchoolDate,
  eachSchoolDate,
} from "@/lib/school-date"
import { sickStreakLengths } from "@/lib/sick-streak"
import { readHolidayDates } from "@/lib/server-holidays"

export type EuksVisitRow = {
  id: string
  studentId: string
  studentName: string
  className: string
  occurredAt: Date
  complaint: string
  treatment: string
  followUp: string | null
  recordedByName: string | null
}

/** Newest visits first; the table shows the whole log. */
export async function readEuksVisits(): Promise<EuksVisitRow[]> {
  const visits = await prisma.euksVisit.findMany({
    select: {
      id: true,
      studentId: true,
      occurredAt: true,
      complaint: true,
      treatment: true,
      followUp: true,
      student: { select: { name: true, schoolClass: { select: { name: true } } } },
      recordedBy: { select: { name: true } },
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  })

  return visits.map((visit) => ({
    id: visit.id,
    studentId: visit.studentId,
    studentName: visit.student.name,
    className: visit.student.schoolClass.name,
    occurredAt: visit.occurredAt,
    complaint: visit.complaint,
    treatment: visit.treatment,
    followUp: visit.followUp,
    recordedByName: visit.recordedBy?.name ?? null,
  }))
}

/** Seluruh konten Pengaturan E-UKS untuk halaman admin dan Halaman Utama. */
export async function readEuksSettings() {
  const [profile, officers, facilities, complaintOptions, heroImages, heroLogos] = await Promise.all([
    prisma.euksProfile.findUnique({ where: { id: "default" } }),
    prisma.euksOfficer.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
        active: true,
        sortOrder: true,
        userId: true,
        // Hanya penanda waktu foto yang diambil, bukan byte-nya: daftar tidak
        // boleh menarik seluruh gambar ke memori server.
        photoUpdatedAt: true,
        user: { select: { name: true, active: true } },
      },
    }),
    prisma.euksFacility.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        quantity: true,
        note: true,
        active: true,
        sortOrder: true,
        photoUpdatedAt: true,
      },
    }),
    prisma.euksComplaintOption.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, active: true, sortOrder: true },
    }),
    prisma.euksHeroImage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        caption: true,
        active: true,
        sortOrder: true,
        // Sama seperti pengurus dan fasilitas: hanya penanda waktunya, supaya
        // daftar tidak pernah menarik byte foto ke memori server.
        photoUpdatedAt: true,
      },
    }),
    prisma.euksHeroLogo.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        active: true,
        sortOrder: true,
        // Alasan sama: byte logo hanya mengalir lewat route penyaji.
        logoUpdatedAt: true,
      },
    }),
  ])

  return {
    profile: {
      name: profile?.name ?? null,
      location: profile?.location ?? null,
      description: profile?.description ?? null,
      serviceHours: profile?.serviceHours ?? null,
      contact: profile?.contact ?? null,
    },
    officers,
    facilities,
    complaintOptions,
    heroImages,
    heroLogos,
  }
}

export type EuksSettingsData = Awaited<ReturnType<typeof readEuksSettings>>

/** Label keluhan baku yang aktif, untuk saran pada form kunjungan. */
export async function readEuksComplaintOptions(): Promise<string[]> {
  const options = await prisma.euksComplaintOption.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { label: true },
  })
  return options.map((option) => option.label)
}

/** Guru yang dapat ditunjuk sebagai pengurus UKS. */
export async function readAssignableTeachers() {
  return prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })
}

/**
 * Kunjungan untuk agregasi tren Halaman Utama.
 *
 * Hanya kolom yang dipakai agregasi yang diambil, dan penyaringan rentang
 * dilakukan di database — bukan memuat seluruh log lalu membuangnya di memori.
 */
export async function readEuksTrendVisits(from: SchoolDate, to: SchoolDate): Promise<TrendVisit[]> {
  const visits = await prisma.euksVisit.findMany({
    where: { occurredAt: prismaSchoolDateRange(from, to) },
    select: { occurredAt: true, complaint: true, treatment: true },
    orderBy: { occurredAt: "asc" },
  })

  return visits.map((visit) => ({
    occurredAt: fromPrismaDate(visit.occurredAt),
    complaint: visit.complaint,
    treatment: visit.treatment,
  }))
}

/** Tanggal kunjungan paling awal dan paling akhir, untuk menentukan rentang. */
export async function readEuksVisitDateRange(): Promise<{ first: SchoolDate; last: SchoolDate } | null> {
  const [first, last] = await Promise.all([
    prisma.euksVisit.findFirst({ select: { occurredAt: true }, orderBy: { occurredAt: "asc" } }),
    prisma.euksVisit.findFirst({ select: { occurredAt: true }, orderBy: { occurredAt: "desc" } }),
  ])
  if (!first || !last) return null
  return { first: fromPrismaDate(first.occurredAt), last: fromPrismaDate(last.occurredAt) }
}

/** Jumlah siswa berbeda yang pernah berkunjung pada rentang. */
export async function countDistinctVisitingStudents(from: SchoolDate, to: SchoolDate): Promise<number> {
  const rows = await prisma.euksVisit.findMany({
    where: { occurredAt: prismaSchoolDateRange(from, to) },
    select: { studentId: true },
    distinct: ["studentId"],
  })
  return rows.length
}

/** Active students for the visit form and selector, grouped by class name. */
export async function readEuksStudentOptions(): Promise<Array<EuksStudentOption & { classId: string }>> {
  const students = await prisma.student.findMany({
    where: { active: true },
    select: { id: true, name: true, classId: true, schoolClass: { select: { name: true } } },
    orderBy: [{ schoolClass: { name: "asc" } }, { name: "asc" }],
  })

  return students.map((student) => ({
    id: student.id,
    name: student.name,
    classId: student.classId,
    className: student.schoolClass.name,
  }))
}

export type EuksClassOption = { id: string; name: string }

/** Classes for the "kelas" selector on the monitoring page. */
export async function readEuksClassOptions(): Promise<EuksClassOption[]> {
  const classes = await prisma.schoolClass.findMany({
    select: { id: true, name: true },
    orderBy: [{ grade: "asc" }, { name: "asc" }],
  })
  return classes
}

export type SickAbsenceRow = {
  id: string
  date: SchoolDate
  note: string | null
  /** Tindak lanjut sekolah; terpisah dari catatan orang tua/siswa. */
  followUp: string | null
  /**
   * Kelas pada hari absensi itu, bukan kelas siswa saat ini. Dipakai untuk
   * menautkan tombol Edit ke Input Absensi yang tepat; siswa yang pindah kelas
   * tetap mengarah ke kelas yang benar-benar mencatat kehadirannya hari itu.
   */
  classId: string
  /** Panjang rentetan sakit yang memuat tanggal ini, hari libur diabaikan. */
  streak: number
}

export type StudentMonitoringData = {
  student: {
    id: string
    name: string
    className: string
    birthDate: string | null
    gender: "LAKI_LAKI" | "PEREMPUAN" | null
  }
  measurements: HealthMeasurement[]
  sickAbsences: SickAbsenceRow[]
  visits: EuksVisitRow[]
}

/**
 * Everything the monitoring page shows for one student. The sick-absence and
 * visit tables are read-only projections of existing Attendance and EuksVisit
 * data — E-UKS never copies student data into its own tables.
 */
export type EuksMonitoringSelection = {
  measurements: boolean
  sickAbsences: boolean
  visits: boolean
}

export async function readStudentMonitoring(
  studentId: string,
  selection: EuksMonitoringSelection = { measurements: true, sickAbsences: true, visits: true },
): Promise<StudentMonitoringData | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      birthDate: true,
      gender: true,
      schoolClass: { select: { name: true } },
    },
  })
  if (!student) return null

  const [measurements, absences, visits] = await Promise.all([
    selection.measurements ? prisma.studentHealthMeasurement.findMany({
      where: { studentId },
      select: { id: true, measuredAt: true, heightCm: true, weightKg: true, note: true },
      orderBy: { measuredAt: "desc" },
    }) : Promise.resolve([]),
    selection.sickAbsences ? prisma.attendance.findMany({
      where: { studentId, status: "SAKIT" },
      select: {
        id: true,
        note: true,
        followUp: true,
        attendanceDay: { select: { date: true, classId: true } },
      },
      orderBy: { attendanceDay: { date: "desc" } },
    }) : Promise.resolve([]),
    selection.visits ? prisma.euksVisit.findMany({
      where: { studentId },
      select: {
        id: true,
        studentId: true,
        occurredAt: true,
        complaint: true,
        treatment: true,
        followUp: true,
        recordedBy: { select: { name: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    }) : Promise.resolve([]),
  ])

  // Hari libur hanya dibaca sepanjang rentang tanggal sakit siswa ini;
  // rentang itu tidak ada celah yang perlu disambung.
  const sickDates = absences.map((item) => fromPrismaDate(item.attendanceDay.date))
  const holidays =
    sickDates.length === 0
      ? []
      : [
          ...(
            await readHolidayDates(
              eachSchoolDate(
                sickDates.reduce((a, b) => (compareSchoolDates(a, b) <= 0 ? a : b)),
                sickDates.reduce((a, b) => (compareSchoolDates(a, b) >= 0 ? a : b)),
              ),
            )
          ).keys(),
        ]

  const streaks = sickStreakLengths(
    sickDates.map((date) => ({ date })),
    holidays,
  )
  const sickAbsences: SickAbsenceRow[] = absences.map((item, index) => ({
    id: item.id,
    date: sickDates[index],
    note: item.note,
    followUp: item.followUp,
    classId: item.attendanceDay.classId,
    streak: streaks[index],
  }))

  return {
    student: {
      id: student.id,
      name: student.name,
      className: student.schoolClass.name,
      birthDate: student.birthDate ? fromPrismaDate(student.birthDate) : null,
      gender: student.gender,
    },
    // Decimal must not cross the server/client boundary as a Prisma object.
    measurements: measurements.map((item) => ({
      id: item.id,
      measuredAt: fromPrismaDate(item.measuredAt),
      heightCm: Number(item.heightCm),
      weightKg: Number(item.weightKg),
      note: item.note,
    })),
    sickAbsences,
    visits: visits.map((visit) => ({
      id: visit.id,
      studentId: visit.studentId,
      studentName: student.name,
      className: student.schoolClass.name,
      occurredAt: visit.occurredAt,
      complaint: visit.complaint,
      treatment: visit.treatment,
      followUp: visit.followUp,
      recordedByName: visit.recordedBy?.name ?? null,
    })),
  }
}

/**
 * Nama tabel berkualifikasi skema, sama seperti pada tren absensi: basis data
 * pengembangan berjalan di skema terisolasi, jadi SQL mentah tidak boleh
 * mengandalkan `search_path`.
 */
function qualifiedTable(table: string) {
  const schema = databaseSchema(process.env.DATABASE_URL ?? "")
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`
  return Prisma.raw(`${quote(schema)}.${quote(table)}`)
}

/**
 * Snapshot status gizi sekolah: satu keranjang per kelas, disusun dari
 * pengukuran valid TERBARU tiap siswa aktif.
 *
 * Satu query untuk seluruh sekolah. `LEFT JOIN LATERAL ... LIMIT 1` memakai
 * indeks `(studentId, measuredAt)` sehingga tidak ada N+1 dan riwayat
 * pengukuran tidak pernah ditarik seluruhnya ke memori — hanya satu baris per
 * siswa yang meninggalkan basis data. `LEFT JOIN` dipertahankan agar siswa yang
 * belum pernah diukur tetap terhitung sebagai cakupan yang belum terpenuhi,
 * bukan menghilang dari penyebut.
 *
 * Pengurutan pemenang deterministik: `measuredAt DESC`, lalu `createdAt DESC`,
 * lalu `id DESC`. Dua baris pada tanggal sama sudah dicegah oleh
 * `@@unique([studentId, measuredAt])`, tetapi urutan penuh membuat hasilnya
 * tetap pasti seandainya batasan itu berubah.
 *
 * Tinggi/berat non-positif disaring di SQL agar tidak terpilih sebagai
 * "terbaru" dan menyisihkan pengukuran sebelumnya yang sahih. Riwayat itu
 * sendiri tidak diubah.
 *
 * Klasifikasi per siswa terjadi di server lalu langsung diringkas menjadi
 * keranjang kelas: yang menyeberang ke browser adalah hitungan per kelas, bukan
 * data kesehatan per siswa.
 */
export async function readSchoolNutritionSnapshot(): Promise<ClassNutritionBucket[]> {
  const studentTable = qualifiedTable("Student")
  const classTable = qualifiedTable("SchoolClass")
  const measurementTable = qualifiedTable("StudentHealthMeasurement")

  const rows = await prisma.$queryRaw<
    Array<{
      classId: string
      className: string
      grade: string
      birthDate: string | null
      gender: "LAKI_LAKI" | "PEREMPUAN" | null
      measuredAt: string | null
      heightCm: string | null
      weightKg: string | null
    }>
  >`
    SELECT
      c."id" AS "classId",
      c."name" AS "className",
      c."grade" AS grade,
      s."birthDate"::text AS "birthDate",
      s."gender"::text AS gender,
      m."measuredAt"::text AS "measuredAt",
      m."heightCm"::text AS "heightCm",
      m."weightKg"::text AS "weightKg"
    FROM ${studentTable} s
    JOIN ${classTable} c ON c."id" = s."classId"
    LEFT JOIN LATERAL (
      SELECT h."measuredAt", h."heightCm", h."weightKg"
      FROM ${measurementTable} h
      WHERE h."studentId" = s."id"
        AND h."heightCm" > 0
        AND h."weightKg" > 0
      ORDER BY h."measuredAt" DESC, h."createdAt" DESC, h."id" DESC
      LIMIT 1
    ) m ON TRUE
    WHERE s."active" = TRUE
  `

  return bucketByClass(
    rows.map((row) =>
      classifyStudentNutrition({
        classId: row.classId,
        className: row.className,
        grade: row.grade,
        birthDate: row.birthDate,
        gender: row.gender,
        latest:
          row.measuredAt && row.heightCm !== null && row.weightKg !== null
            ? {
                measuredAt: row.measuredAt,
                heightCm: Number(row.heightCm),
                weightKg: Number(row.weightKg),
              }
            : null,
      }),
    ),
  )
}

import { prisma } from "@/lib/prisma"
import type { EuksStudentOption, HealthMeasurement } from "@/lib/euks"
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
  const [profile, officers, facilities, complaintOptions, heroImages] = await Promise.all([
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
export async function readStudentMonitoring(studentId: string): Promise<StudentMonitoringData | null> {
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
    prisma.studentHealthMeasurement.findMany({
      where: { studentId },
      select: { id: true, measuredAt: true, heightCm: true, weightKg: true, note: true },
      orderBy: { measuredAt: "desc" },
    }),
    prisma.attendance.findMany({
      where: { studentId, status: "SAKIT" },
      select: {
        id: true,
        note: true,
        followUp: true,
        attendanceDay: { select: { date: true, classId: true } },
      },
      orderBy: { attendanceDay: { date: "desc" } },
    }),
    prisma.euksVisit.findMany({
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
    }),
  ])

  // Hari libur hanya dibaca sepanjang rentang tanggal sakit siswa ini; di luar
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
